import * as THREE from 'three';
import * as Nodes from 'three/examples/jsm/nodes/Nodes';
import { decode } from 'base64-arraybuffer';
import { TextureNode } from 'three/examples/jsm/nodes/Nodes';
import CubicSpline from './cubic_spline_interpolant';
import { AnimationClip } from 'three';

const componentTypes = {
  5120: { type: 'BYTE', size: 1, array: Int8Array },
  5121: { type: 'UNSIGNED_BYTE', size: 1, array: Uint8Array },
  5122: { type: 'SHORT', size: 2, array: Int16Array },
  5123: { type: 'UNSIGNED_SHORT', size: 2, array: Uint16Array },
  5125: { type: 'UNSIGNED_INT', size: 4, array: Uint32Array },
  5126: { type: 'FLOAT', size: 4, array: Float32Array },
}

const typeFormats = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

const attributeIDs = {
  POSITION: 'position',
  NORMAL: 'normal',
  TANGENT: 'tangent',
  TEXCOORD_0: 'uv',
  TEXCOORD_1: 'uv2',
  TEXCOORD_2: 'uv3',
  TEXCOORD_3: 'uv4',
  TEXCOORD_4: 'uv5',
  TEXCOORD_5: 'uv6',
  TEXCOORD_6: 'uv7',
  TEXCOORD_7: 'uv8',
  COLOR_0: 'color',
  WEIGHTS_0: 'skinWeight',
  JOINTS_0: 'skinIndex',
};

const textureFilters = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter
};

const textureWrappings = {
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping
};

const primitiveMap = [
  (g, m, s) => new THREE.Points(g, m),
  (g, m, s) => new THREE.LineSegments(g, m),
  (g, m, s) => new THREE.LineLoop(g, m),
  (g, m, s) => new THREE.Line(g, m),
  (g, m, s) => s ? new THREE.SkinnedMesh(g, m) : new THREE.Mesh(g, m),
  (g, m, s) => s ? new THREE.SkinnedMesh(THREE.BufferGeometryUtils.toTrianglesDrawMode(g, THREE.TriangleStripDrawMode), m) : new THREE.Mesh(THREE.BufferGeometryUtils.toTrianglesDrawMode(g, THREE.TriangleStripDrawMode), m),
  (g, m, s) => s ? new THREE.SkinnedMesh(THREE.BufferGeometryUtils.toTrianglesDrawMode(g, THREE.TriangleFanDrawMode), m) : new THREE.Mesh(THREE.BufferGeometryUtils.toTrianglesDrawMode(g, THREE.TriangleFanDrawMode), m),
]

const interpolantMap = {
  STEP: THREE.DiscreteInterpolant,
  LINEAR: THREE.LinearInterpolant,
  CUBICSPLINE: CubicSpline,
}

const pathMap = {
  translation: { property: 'position', track: THREE.VectorKeyframeTrack },
  rotation: { property: 'rotation', track: THREE.QuaternionKeyframeTrack },
  scale: { property: 'scale', track: THREE.VectorKeyframeTrack },
  weight: { property: 'morphTargetInfluences', track: THREE.NumberKeyframeTrack },
}

const typeScale = {};
typeScale[Int8Array] = 1 / 127;
typeScale[Uint8Array] = 1 / 255;
typeScale[Int16Array] = 1 / 32767;
typeScale[Uint16Array] = 1 / 65535;
typeScale[Float32Array] = 1;

const data_uri_regex = /data:(?<mime>[\w/\-\.]+);(?<encoding>\w+),(?<data>.*)/;

const INVALID_DIR = new Error('Gltf Deserializer must be passed a valid directory that contains a gltf file');

export default async function (files, renderer) {
  // try to parse the first gltf file found in directory
  if (!files instanceof Array) throw INVALID_DIR;
  
  let gltfFile = undefined;
  for (let i = 0; i < files.length; i++) {
    if (!files[i].name || !files[i].name.endsWith('.gltf')) continue;
    gltfFile = files[i];
    break;
  }

  if (gltfFile === undefined) throw INVALID_DIR;

  gltf = JSON.parse(await gltfFile.text());
  
  gltf['JITR_FILES'] = {};

  for (let i = 0; i < files.length; i++) {
    let path = files[i].webkitRelativePath;
    path = path.substring(path.indexOf('/') + 1);
    gltf['JITR_FILES'][path] = files[i];
  }

  const cameras = [];
  const scenes = {};
  const nodes = {};
  const buffers = {};
  const accesses = {};
  const materials = {};
  const textures = {'images': {}};
  const lights = {};
  const bones = {};
  const skinnedMeshes = {};

  const envMap = createEnviroment(renderer);

  if (gltf.skins instanceof Array) {
    for (let i = 0; i < gltf.skins.length; i++) {
      for (let j = 0; j < gltf.skins[i].joints.length; j++) {
        bones[gltf.skins[i].joints[j]] = true;
      }
    }
  }

  // import scenes
  for (let i = 0; i < gltf.scenes.length; i++) {
    let scene = gltf.scenes[i];
    let sceneObj = new THREE.Scene();
    scenes[i] = {
      'name': scene.name || `Scene ${i}`,
      'container': sceneObj,
      'extensions': scene.extensions,
      'extras': scene.extras,
    }

    sceneObj.background = envMap;
    
    // import nodes if not already imported
    if (!scene.nodes || !scene.nodes.length) continue;
    let sceneNodes = scene.nodes;
    for (let j = 0; j < sceneNodes.length; j++) {
      let nodeIndex = sceneNodes[j];
      if (!nodes[nodeIndex]) await importNode(nodeIndex, gltf, nodes, cameras, lights, materials, bones, textures, accesses, buffers, new Nodes.TextureCubeNode(new Nodes.TextureNode(envMap)));
      sceneObj.add(nodes[sceneNodes[j]]);
    }
  }

  await importSkins(gltf, bones, skinnedMeshes, accesses, buffers);
  const animations = await importAnimations(gltf, nodes, accesses, buffers);

  return { scenes, cameras, nodes, lights, animations };
}

async function importSkins(gltf, boneNodes, skinnedMeshes, accesses, buffers) {
  for (const [skinIndex, mesh] of Object.entries(skinnedMeshes)) {
    const skin = gltf.skins[skinIndex];
    const bones = skin.joints.map(jointIndex => boneNodes[jointIndex]);
    const mats = [];
    
    if (skin.inverseBindMatrices !== undefined) {
      if (accesses[skin.inverseBindMatrices] === undefined) await accessBuffer(skin.inverseBindMatrices, gltf, accesses, buffers, false);
      let matBuffer = accesses[skin.inverseBindMatrices];
      for (let i = 0; i < matBuffer.length; i += 16) mats.push((new THREE.Matrix4()).fromArray(matBuffer, i));
    }
    
    mesh.bind(new THREE.Skeleton(bones, mats.length > 0 ? mats : undefined), mesh.matrixWorld);
  }
}

async function importAnimations(gltf, nodes, accesses, buffers) {
  const animations = [];

  for (let i = 0; i < gltf.animations.lenghth; i++) {
    const anim = gltf.animations[i];
    const tracks = [];

    for (let j = 0; j < anim.channels.length; j++) {
      const sampler = anim.samplers[anim.channels[j].sampler];
      const path = pathMap[anim.channels[j].target.path];
      const node = nodes[anim.channels[j].target.path];

      const input = await accessBuffer(sampler.input, gltf, accesses, buffers, false);
      const output = await accessBuffer(sampler.output, gltf, accesses, buffers, false);

      node.updateMatrix();
      node.matrixAutoUpdate = true;

      const ids = [];
      if (path.property === 'morphTargetInfluences') {
        node.traverse((o) => {
          if (o.isMesh === true && o.morphTargetInfluences) ids.push(o.uuid);
        });
      }
      else ids.push(node.uuid);

      const interpolant = interpolantMap[sampler.interpolation];

      for (let k = 0; k < ids.length; k++) {
        const track = new path.track(`${ids[k]}.${path.property}`, input, output, interpolant);
  
        if (interpolant === CubicSpline) {
          track.createInterpolant = function InterpolantFactory(r) {
            return new CubicSpline(this.times, this.values, this.getValueSize() / 3, r);
          }
          track.createInterpolant.isInterpolantCubicSpline = true;
        }
  
        tracks.push(track);
      }
    }

    animations.push(new AnimationClip(anim.name ? anim.name : `animation_${i}`, undefined, tracks));
  }

  return animations;
}

async function importNode(nodeIndex, gltf, nodes, cameras, lights, materials, bones, skinnedMeshes, textures, accesses, buffers, envMap) {
  const node = gltf.nodes[nodeIndex];
  let nodeObj = undefined;

  // make node a bone if necessary
  if (bones[nodeIndex] === true) {
    nodeObj = new THREE.Bone();
    bones[nodeIndex] = nodeObj;
  }
  else nodeObj = new THREE.Object3D();

  // make the node a camera if appropriate
  if (node.camera !== undefined) {
    let camTemplate = gltf.cameras[node.camera];
    let cam = undefined;

    if (camTemplate.type === 'perspective') {
      cam = new THREE.PerspectiveCamera(
        camTemplate.perspective.yfov,
        camTemplate.perspective.aspectRatio,
        camTemplate.perspective.znear,
        camTemplate.perspective.zfar || Number.MAX_VALUE
      );
    }
    else {
      cam = new THREE.OrthographicCamera(
        -camTemplate.orthographic.xmag / 2.0,
        camTemplate.orthographic.xmag / 2.0,
        camTemplate.orthographic.ymag / 2.0,
        -camTemplate.orthographic.ymag / 2.0,
        camTemplate.orthographic.znear,
        camTemplate.orthographic.zfar
      );
    }

    cam.name = `~CAMERA~${camTemplate.name || ''}`;
    nodeObj.add(cam);
    cameras.push(cam);
  }

  // give the node a name if appropriate
  if (node.name) nodeObj.name = node.name;

  // set the nodes transform
  if (node.matrix) nodeObj.matrix.elements = node.matrix;
  else {
    let translation = node.translation || [0, 0, 0];
    let rotation = node.rotation || [0, 0, 0, 1];
    let scale = node.scale || [1, 1, 1];
    nodeObj.position.set(translation[0], translation[1], translation[2]);
    nodeObj.rotation.setFromQuaternion(new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]));
    nodeObj.scale.set(scale[0], scale[1], scale[2]);
  }

  if (node.mesh !== undefined) {
    const mesh = await createMesh(node.mesh, node.skin !== undefined, gltf, materials, bones, textures, accesses, buffers, envMap);
    nodeObj.add(mesh);
    if (node.skin !== undefined) skinnedMeshes[node.skin] = mesh;
  }

  // lighting
  const light = ((node.extensions || {}).KHR_lights_punctual || {}).light;
  if (light !== undefined) {
    if (lights[light] === undefined) importLight(light, gltf);
    nodeObj.add(lights[light].clone());
  }

  nodes.add(nodeObj);

  // create children
  if (node.children instanceof Array) {
    for (let i = 0; i < node.children.length; i++) {
      let childIndex = node.children[i];
      if (!nodes[childIndex]) await importNode(gltf.nodes[childIndex], gltf, nodes, cameras, lights, materials, bones, skinnedMeshes, textures, accesses, buffers, envMap);

      nodeObj.add(nodes[childIndex]);
    }
  }
}

async function createMesh(meshIndex, skinned, gltf, materials, textures, accesses, buffers, envMap) {
  const mesh = gltf.meshes[meshIndex];
  let meshGroup = new THREE.Group();
  
  meshGroup.name = `MESH_${mesh.name || meshIndex}`;

  for (let i = 0; i < mesh.primitives.length; i++) {
    let primitive = mesh.primitives[i];
    let geom = new THREE.BufferGeometry();

    // add indices
    if (primitive.index !== undefined) {
      if (accesses[primitive.index] === undefined) await accessBuffer(primitive.index, gltf, accesses, buffers);
      geom.setIndex(accesses[primitive.index]);
    }
    
    // add attributes
    for (const [attribute, accessor] of Object.entries(primitive.attributes)) {
      if (accesses[accessor] === undefined) await accessBuffer(accessor, gltf, accesses, buffers);
      geom.setAttribute(attributeIDs[attribute], accesses[accessor]);
    }

    let addedTargets = false;
    // add morph targets
    if (primitive.targets instanceof Array) {
      const morphTargets = {};

      for (let j = 0; j < primitive.targets.length; j++) {
        for (const [attribute, accessor] of Object.entries(primitive.targets[i])) {
          if (accesses[accessor] === undefined) await accessBuffer(accessor, gltf, accesses, buffers);
          morphTargets[attribute] = [];
        }
      }

      for (let j = 0; j < primitive.targets.length; j++) {
        for (const [attribute, map] of Object.entries(morphTargets)) {
          let id = attributeIDs[attribute];
          let accessor = primitive.targets[i][attribute];
          map.push(accessor === undefined ? geom.attributes[id] : accesses[accessor]);
        }
      }

      for (const [attribute, map] of Object.entries(morphTargets)) {
        geom.morphAttributes[attributeIDs[attribute]] = map;
      }

      addedTargets = true;
      geom.morphTargetsRelative = true;
    }

    if (materials[primitive.material] === undefined) await importMaterial(primitive.material, gltf, materials, textures, envMap);
    let material = materials[primitive.material];

    const vTan = geom.attributes.tangent !== undefined;
    const vCol = geom.attributes.color !== undefined;
    const noNorm = geom.attributes.normal === undefined;
    const mTargets = Object.keys(geom.morphAttributes).length > 0;
    const mNormals = mTargets && geom.morphAttributes.normal !== undefined;

    if (skinned || vTan || vCol || noNorm || mTargets) {
      const key = `${primitive.material}-${(skinned ? 16 : 0) | (vTan ? 8 : 0) | (vCol ? 4 : 0) | (noNorm ? 2 : 0) | (mTargets ? 1 : 0)}`
      if (materials[key] === undefined) {
        materials[key] = material.clone();
        if (skinned) material.skinning = true;
        if (vTan) material.vertexTangents = true;
        if (vCol) material.vertexColors = true;
        if (noNorm) material.flatShading = true;
        if (mTargets) material.morphTargets = true;
        if (mNormals) material.morphNormals = true;
      }
      
      material = materials[key];
    }

    if (!vTan && (material.normal !== undefined || material.clearcoatNormal !== undefined)) {
      material = material.clone();
      if (material.normal !== undefined)
        material.normal.scale = new Nodes.OperatorNode(new Nodes.Vector2Node(1, -1), material.normal.scale, Nodes.OperatorNode.MUL);
  
      if (material.clearcoatNormal !== undefined)
        material.clearcoatNormal.scale = new Nodes.OperatorNode(new Nodes.Vector2Node(1, -1), material.clearcoatNormal.scale, Nodes.OperatorNode.MUL);
    }

    let primitiveObj = primitiveMap[primitive.mode](goem, material, skinned);

    if (addedTargets) {
      primitiveObj.updateMorphTargets();
      if (mesh.weights instanceof Array) {
        for (let i = 0; i < mesh.weights.length; i++) {
          primitiveObj.morphTargetInfluences[i] = mesh.weights[i];
        }
      }
    }

    meshGroup.add(primitiveObj);
  }
}

async function importMaterial(materialIndex, gltf, materials, textures, envMap) {
  let material = gltf.materials[materialIndex];
  let mat = new Nodes.StandardNodeMaterial();

  const { MUL, ADD } = Nodes.OperatorNode;

  // handle meshes with no materials
  if (material === undefined) {
    if (materials[undefined] === undefined) materials[undefined] = materialObj;
    return;
  }

  const uvNodes = {};
  const uvNode = (index) =>  {
    if (uvs[index] === undefined) uvs[index] = new Nodes.UVNode(index);
    return uvs[index];
  };
  const texNode = (tex, sRGB = false) => {
    if (textures[tex.index] === undefined) importTexture(tex.index);
    if (sRGB) textures[tex.index].encoding = THREE.sRGBEncoding;
    return new TextureNode(textures[tex.index], uvNode(tex.texCoord));
  }

  // normal mapping
  if (material.normalTexture !== undefined) {
    mat.normal = new Nodes.NormalMapNode(
      texNode(material.normalTexture),
      material.normalTexture.scale === undefined ? 1.0 : material.normalTexture.scale
    );
  }

  // ambient occlusion
  if (material.occlusionTexture !== undefined) {
    mat.ao = new Nodes.FloatNode(material.occlusionTexture.stength === undefined ? 1.0 : material.occlusionTexture.stength);
    mat.ao = new Nodes.OperatorNode(mat.ao, new nodes.SwitchNode(texNode(material.occlusionTexture), 'x'), MUL);
  }

  // emission
  mat.emissive = new Nodes.ColorNode(0xffffff);
  if (material.emissiveFactor)
    mat.emissive = new Nodes.ColorNode(material.emissiveFactor[0], material.emissiveFactor[1], material.emissiveFactor[2]);
  if (material.emissiveTexture)
    mat.emissive = new Nodes.OperatorNode(mat.emissive, new nodes.SwitchNode(texNode(material.emissiveTexture, true), 'xyz'), MUL);

  // alpha rendering
  if (material.alphaMode !== 'BLEND') {
    mat.depthWrite = true;
    mat.mask = new Nodes.CondNode(
      mat.alpha,
      material.alphaMode !== 'MASK' ? new Nodes.FloatNode(0) : new Nodes.FloatNode(material.alphaCutoff === undefined ? 0.5 : material.alphaCutoff),
      Nodes.CondNode.GREATER
    );
    mat.alpha = undefined;
  }
  else mat.depthWrite = false;

  // side rendering
  mat.side = material.doubleSided ? THREE.DoubleSide : THREE.FrontSide;

  // pbr properties
  const pbr = material.pbrMetallicRoughness;
  if (pbr !== undefined) {
    // color and opacity
    mat.color = new Nodes.ColorNode(0xffffff);
    mat.alpha = new Nodes.FloatNode(1.0);

    if (pbr.baseColorFactor !== undefined) {
      mat.color = new Nodes.ColorNode(pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2]);
      mat.alpha = new Nodes.FloatNode(pbr.baseColorFactor[3]);
    }
  
    if (pbr.baseColorTexture !== undefined) {
      const colorTex = texNode(pbr.baseColorTexture, true);
      mat.color = new Nodes.OperatorNode(mat.color, new Nodes.SwitchNode(colorTex, 'xyz'), MUL);
      if (colorTex.value.format !== THREE.RGBFormat)
        mat.alpha = new Nodes.OperatorNode(mat.opacity, new Nodes.SwitchNode(colorTex, 'w'), MUL);
    }

    // metallicness and roughness
    mat.metalness = new Nodes.FloatNode(pbr.metallicFactor === undefined ? 1.0 : pbr.metallicFactor);
    mat.roughness = new Nodes.FloatNode(pbr.roughnessFactor === undefined ? 1.0 : pbr.roughnessFactor);
    if (pbr.metallicRoughnessTexture !== undefined) {
      const mrTex = texNode(pbr.metallicRoughnessTexture);
      mat.metalness = new Nodes.OperatorNode(new Nodes.SwitchNode(mrTex, 'z'), mat.reflectivity, MUL);
      mat.roughness = new Nodes.OperatorNode(new Nodes.SwitchNode(mrTex, 'y'), mat.roughness, MUL);
    }
  }

  // clearcoat extension
  const clearcoat = (material.extensions || {}).KHR_materials_clearcoat;
  if (clearcoat !== undefined) {
    mat.clearcoat = new Nodes.FloatNode(clearcoat.clearcoatFactor === undefined ? 0.0 : clearcoat.clearcoatFactor);
    if (clearcoat.clearcoatTexture !== undefined)
      mat.clearcoat = new Nodes.OperatorNode(new Nodes.SwitchNode(texNode(clearcoat.clearcoatTexture), 'x'), mat.clearcoat, MUL);

    mat.clearcoatRoughness = new Nodes.FloatNode(clearcoat.clearcoatRoughnessFactor === undefined ? 0.0 : clearcoat.clearcoatRoughnessFactor);
    if (clearcoat.clearcoatRoughnessTexture !== undefined)
      mat.clearcoatRoughness = new Nodes.OperatorNode(new Nodes.SwitchNode(texNode(clearcoat.clearcoatRoughnessTexture), 'y'), mat.clearcoatRoughness, MUL);

    if (clearcoat.clearcoatNormalTexture !== undefined) {
      mat.clearcoatNormal = new Nodes.NormalMapNode(
        texNode(clearcoat.clearcoatNormalTexture),
        clearcoat.clearcoatNormalTexture.scale === undefined ? 1.0 : clearcoat.clearcoatNormalTexture.scale
      );
    }
  }

  // sheen extension
  const sheen = (material.extensions || {}).KHR_materials_sheen;
  if (sheen !== undefined) {
    mat.sheen = new Nodes.ColorNode(0x000000);

    if (sheen.sheenColorFactor !== undefined)
      mat.sheen = new Nodes.ColorNode(sheen.sheenColorFactor[0], sheen.sheenColorFactor[1], sheen.sheenColorFactor[2]);
    if (sheen.sheenColorTexture !== undefined) 
      mat.sheen = new Nodes.OperatorNode(mat.sheen, new Nodes.SwitchNode(texNode(sheen.sheenColorTexture), 'xyz'), MUL);

    if (sheen.sheenRoughnessFactor != undefined || sheen.sheenRoughnessTexture != undefined) {
      let sheenRoughness = new Nodes.FloatNode(sheen.sheenRoughnessFactor === undefined ? 0.0 : sheen.sheenRoughnessFactor)
      if (sheen.sheenRoughnessTexture){
        const roughTex = texNode(sheen.sheenRoughnessTexture);
        if (roughTex.value.format !== THREE.RGBFormat)
          sheenRoughness = new Nodes.OperatorNode(new Nodes.SwitchNode(roughTex, 'w'), scale, MUL);
      }
      mat.roughness = new Nodes.OperatorNode(new Nodes.OperatorNode(mat.roughness, sheenRoughness, ADD), new Nodes.FloatNode(0.5), MUL);
    }
  }

  mat.environment = envMap;

  materials[materialIndex] = mat;
}

function importLight(lightIndex, gltf, lights) {
  const lightTemplates = ((gltf.extensions || {}).KHR_lights_punctual || {}).lights;
  const light = lightTemplates[lightIndex];

  if (light === undefined) {
    lights[lightIndex] = new THREE.PointLight(0x000000, 0, 0.0001, 100);
    return;
  }

  const color = light.color !== undefined ? new THREE.Color(light.color[0], light.color[1], light.color[2]) : new THREE.Color(0xffffff);
  const intensity = light.intensity !== undefined ? light.intensity : 1.0;
  const range = light.range !== undefined ? light.range : 0;

  switch (light.type) {
    case 'directional':
      lights[lightIndex] = new THREE.DirectionalLight(color, intensity);
      return;
    case 'point':
      lights[lightIndex] = new THREE.PointLight(color, intensity, range, 2);
      return;
    case 'spot':
      let inner = (light.spot || {}).innerConeAngle;
      inner = inner !== undefined ? inner : 0;
      
      let outer = (light.spot || {}).outerConeAngle;
      outer = outer !== undefined ? outer : 0.78539816339;

      lights[lightIndex] = new THREE.SpotLight(color, intensity, range, outer, 1.0 - (inner / outer), 2);
      return;
  }
}

async function accessBuffer(accessorIndex, gltf, accesses, buffers, attribute = true) {
  // get information about accessor
  const accessor = gltf.accessors[accessorIndex];
  let view = gltf.bufferViews[accessor.bufferView];

  let component = componentTypes[accessor.componentType];
  let formatCount = typeFormats[accessor.type];

  // calculate the position and size of the buffer access
  let byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  let byteLength = component.size * formatCount * accessor.count;

  if (buffers[view.buffer] === undefined) await importBuffer(view.buffer, gltf, buffers);

  // create view into buffer using appropriate array type, copy view and replace values if accessor is sparse
  let typed_buffer = new component.array(buffers[view.buffer], byteOffset, byteLength);
  if (accessor.sparse && accessor.count > 0) {
    typed_buffer = typed_buffer.slice();
    const indicesInfo = accessor.sparse.indices;
    const valuesInfo = accessor.sparse.values;

    // get view into appropriate buffer for indices
    let indexView = gltf.bufferViews[indicesInfo.bufferView];
    if (buffers[indexView.buffer] === undefined) await importBuffer(indexView.buffer, gltf, buffers);

    const indexType = componentTypes[indicesInfo.componentType];
    const indicesOffset = (indexView.byteOffset || 0) + (indicesInfo.byteOffset || 0);
    const indicesLength = indexType.size * accessor.sparse.count;

    const indices = new indexType.array(buffers[indexView.buffer], indicesOffset, indicesLength);
    
    // get view into appropriate buffer for values
    let valueView = gltf.bufferViews[valuesInfo.bufferView];
    if (buffers[valueView.buffer] === undefined) await importBuffer(valueView.buffer, gltf, buffers);

    const valuesOffset = (valueView.byteOffset || 0) + (valueView.byteOffset || 0);
    const valuesLength = component.size * formatCount * accessor.sparse.count;

    const values = new component.array(buffers[valueView.buffer], valuesOffset, valuesLength);

    // replace values in main accessor array
    for (let i = 0; i < accessor.sparse.count; i++) {
      for (let j = 0; j < formatCount; j++) 
        typed_buffer[(indices[i] * formatCount) + j] = values[(i * formatCount) + j];
    }
  }

  if (attribute) accesses[accessorIndex] = new THREE.BufferAttribute(typed_buffer, formatCount, accessor.normalized === true);
  else {
    if (accessor.normalized === true) {
      let scale = typeScale[typed_buffer.constructor];
      let scaled = new Float32Array(typed_buffer.length);
      for (let i = 0; i < scaled.length; i++) scaled[i] = typed_buffer[i] * scale;
      typed_buffer = scaled;
    }

    accesses[accessorIndex] = typed_buffer;
  }
}

async function importBuffer(bufferIndex, gltf, buffers) {
  const buffer = gltf.buffers[bufferIndex];
  if (data_uri_regex.test(buffer.uri)) buffers[bufferIndex] = decode(data_uri_regex.exec(buffer.uri).groups.data);
  else buffers[bufferIndex] = await gltf['JITR_FILES'][buffer.uri].arrayBuffer();
}

function importTexture(textureIndex, gltf, textures) {
  const texture = gltf.textures[textureIndex];
  const sampler = gltf.samplers[texture.sampler];

  let textureObj = new THREE.Texture();
  textureObj.wrapS = textureFilters[sampler.wrapS] || THREE.LinearFilter;
  textureObj.wrapT = textureFilters[sampler.wrapT] || THREE.LinearMipmapLinearFilter;
  textureObj.magFilter = textureWrappings[sampler.magFilter] || THREE.RepeatWrapping;
  textureObj.minFilter = textureWrappings[sampler.minFilter] || THREE.RepeatWrapping;
  textureObj.flipY = false;

  let alpha = true;
  if (textures.images[texture.source] === undefined) {
    const image = new Image();

    let image_uri = gltf.images[texture.source];
    
    let imageContainer = undefined;
    if (data_uri_regex.test(image_uri)) {
      const imageInfo = data_uri_regex.exec(image_uri).groups;
      alpha = !(imageInfo.mime.endsWith('jpeg') || imageInfo.mime.endsWith('jpg'));
      imageContainer = new Blob([decode(imageInfo.data)]);
    }
    else {
      alpha = gltf['JITR_FILES'][image_uri].type !== 'image/jpeg';
      imageContainer = gltf['JITR_FILES'][image_uri];
    }

    image.src = URL.createObjectURL(imageContainer);
    image.onload(() => {
      texture.image = image;
      texture.needsUpdate = true;
    });
    textures.images[texture.source] = image;
  }
  
  if (!alpha) textureObj.format = THREE.RGBFormat;
  textureObj.image = textures.images[texture.source];
  textureObj.needsUpdate = true;
  textures[textureIndex] = textureObj;
}

// https://github.com/mrdoob/three.js/blob/master/examples/webgl_materials_envmaps_hdr_nodes.html
function createEnviroment(renderer) {
  const envScene = new THREE.Scene();

  const geometry = new THREE.BoxBufferGeometry();
  geometry.deleteAttribute('uv');
  const roomMaterial = new THREE.MeshStandardMaterial({ metalness: 0, side: THREE.BackSide });
  const room = new THREE.Mesh(geometry, roomMaterial);
  room.scale.setScalar(10);
  envScene.add(room);

  const mainLight = new THREE.PointLight(0xffffff, 50, 0, 2);
  envScene.add(mainLight);

  const lightMaterial = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 10 });

  const light1 = new THREE.Mesh(geometry, lightMaterial);
  light1.position.set(-5, 2, 0);
  light1.scale.set(0.1, 1, 1);
  envScene.add(light1);

  const light2 = new THREE.Mesh(geometry, lightMaterial);
  light2.position.set(0, 5, 0);
  light2.scale.set(1, 0.1, 1);
  envScene.add(light2);

  const light3 = new THREE.Mesh(geometry, lightMaterial);
  light3.position.set(2, 1, 5);
  light3.scale.set(1.5, 2, 0.1);
  envScene.add(light3);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileCubemapShader();
  return pmremGenerator.fromScene(envScene, 0.04).texture;
}