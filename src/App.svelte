<svelte:window on:keydown={openFileWindow}/>
<main>
	<div bind:this={parent}></div>
	<input type="file" bind:this={fileInput} style="display: none;" on:change={attemptLoad} webkitdirectory multiple>
	<h1>COOL ANIMATION APP GOES HERE.</h1>
	<p>ah shoot, guess that didn't work...</p>
</main>

<script>
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import load from './gltf/load';
	
	let fileInput;
	let parent;
	let camera, scene, renderer;
	let geometry, material, mesh;
	
	function init() {
		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
		renderer = new THREE.WebGLRenderer();
		renderer.setSize(window.innerWidth, window.innerHeight);
		parent.appendChild(renderer.domElement);

		camera.position.z = 5;
	}

	function animate() {
		requestAnimationFrame(animate);
		mesh.rotation.x += 0.001;
		mesh.rotation.y += 0.02;

		renderer.render(scene, camera);
	}

	function openFileWindow(e) {
		if (e.which != 73) return;
		fileWindow.click();
	}

	function attemptLoad() {
		if (fileInput.files === undefined || fileInput.files.length === 0) return;
		load(fileInput.files);
	}

	onMount(() => {
		init();
	});
	</script>

<style>
	main {
		text-align: center;
		padding: 1em;
		max-width: 240px;
		margin: 0 auto;
	}

	h1 {
		color: #ff3e00;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 100;
	}

	@media (min-width: 640px) {
		main {
			max-width: none;
		}
	}
</style>