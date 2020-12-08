import * as THREE from 'three';
import { decode } from 'base64-arraybuffer';

const componentTypes = {
  5120: { 'type': 'BYTE', 'size': 1, 'array': Int8Array },
  5121: { 'type': 'UNSIGNED_BYTE', 'size': 1, 'array': Uint8Array },
  5122: { 'type': 'SHORT', 'size': 2, 'array': Int16Array },
  5123: { 'type': 'UNSIGNED_SHORT', 'size': 2, 'array': Uint16Array },
  5125: { 'type': 'UNSIGNED_INT', 'size': 4, 'array': Uint32Array },
  5126: { 'type': 'FLOAT', 'size': 4, 'array': Float32Array },
}

const typeFormats = {
  'SCALAR': 1,
  'VEC2': 2,
  'VEC3': 3,
  'VEC4': 4,
  'MAT2': 4,
  'MAT3': 9,
  'MAT4': 16,
}

const primitiveMap = [
  (g, m) => new THREE.Points(g, m),
  (g, m) => new THREE.LineSegments(g, m),
  (g, m) => new THREE.LineLoop(g, m),
  (g, m) => new THREE.Line(g, m),
  (g, m) => new THREE.Mesh(g, m),
  (g, m) => new THREE.Mesh(THREE.BufferGeometryUtils.toTrianglesDrawMode(g, THREE.TriangleStripDrawMode), m),
  (g, m) => new THREE.Mesh(THREE.BufferGeometryUtils.toTrianglesDrawMode(g, THREE.TriangleFanDrawMode), m),
]

const data_uri_regex = /data:(?<mime>[\w/\-\.]+);(?<encoding>\w+),(?<data>.*)/;

const INVALID_DIR = new Error('Gltf Deserializer must be passed a valid directory that contains a gltf file');

export default async function (files) {
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

  let cameras = [];
  let scenes = {};
  let nodes = {};
  let buffers = {};
  let accesses = {};

  // import scenes
  for (let i = 0; i < gltf.scenes.length; i++) {
    let scene = gltf.scenes[i];
    let container = new THREE.Scene();
    scenes[i] = {
      'name': scene.name || `Scene ${i}`,
      'container': container,
      'extensions': scene.extensions,
      'extras': scene.extras,
    }
    
    // import nodes if not already imported
    if (!scene.nodes || !scene.nodes.length) continue;
    let sceneNodes = scene.nodes;
    for (let j = 0; j < sceneNodes.length; j++) {
      let nodeIndex = sceneNodes[j];
      if (!nodes[nodeIndex]) await importNode(nodeIndex, gltf, nodes, cameras, accesses, buffers);
      container.add(nodes[sceneNodes[j]]);
    }
  }
}

async function importNode(nodeIndex, gltf, nodes, cameras, accesses, buffers) {
  const node = gltf.nodes[nodeIndex];
  let nodeObj = new THREE.Object3D();

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

  if (node.mesh !== undefined) nodeObj.add(await createMesh(node.mesh, gltf, accesses, buffers));

  // TODO: skin, extensions, extras

  nodes.add(nodeObj);

  // create children
  if (node.children instanceof Array) {
    for (let i = 0; i < node.children.length; i++) {
      let childIndex = node.children[i];
      if (!nodes[childIndex]) await importNode(gltf.nodes[childIndex], gltf, nodes, cameras, accesses, buffers);

      nodeObj.add(nodes[childIndex]);
    }
  }
}


async function createMesh(meshIndex, gltf, accesses, buffers) {
  const mesh = gltf.meshes[meshIndex];
  let meshGroup = new THREE.Group();
  meshGroup.name = `~MESH~${mesh.name || `MESH_${meshIndex}`}`;

  for (let i = 0; i < mesh.primitives.length; i++) {
    let primitive = mesh.primitives[i];
    let geom = new THREE.BufferGeometry();

    if (accesses[primitive.index] === undefined) await accessBuffer(primitive.index, gltf, accesses, buffers);
    geom.setIndex(accesses[primitive.index]);
    
    
    for (const [attribute, accessor] of Object.entries(primitive.attributes)) {
      if (accesses[accessor] === undefined) await accessBuffer(accessor, gltf, accesses, buffers);
      geom.setAttribute(attribute, accesses[accessor]);
    }

    // TODO: ADD MATERIALS
    meshGroup.add(primitiveMap[primitive.mode](goem, ))
  }
}

async function accessBuffer(accessorIndex, gltf, accesses, buffers) {
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

  accesses[accessorIndex] = new THREE.BufferAttribute(typed_buffer, formatCount);
}

async function importBuffer(bufferIndex, gltf, buffers) {
  const buffer = gltf.buffers[bufferIndex];
  if (data_uri_regex.test(buffer.uri)) buffers[bufferIndex] = decode(data_uri_regex.exec(buffer.uri).groups.data);
  else buffers[bufferIndex] = await gltf['JITR_FILES'][buffer.uri].arrayBuffer();
}