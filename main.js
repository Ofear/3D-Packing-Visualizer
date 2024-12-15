// main.js

const loadSettings = () => {
    const defaultSettings = {
        language: 'he',
        defaultUnit: 'mm',
        surfaceWidth: 1000,
        surfaceDepth: 1200,
        itemColor: '#4287f5',
        containerColor: '#bc9166'
    };
    const activeSceneName = localStorage.getItem('lastActiveScene');
    const savedScenes = JSON.parse(localStorage.getItem('packingVisualizerScenes') || '{}');
    const savedSceneSettings = savedScenes[activeSceneName] ? savedScenes[activeSceneName].settings : undefined;
    if (savedSceneSettings) {
        console.log('Loaded settings from active scene:', savedSceneSettings);
        return savedSceneSettings;
    }
    const savedSettings = localStorage.getItem('packingVisualizerSettings');
    return savedSettings ? JSON.parse(savedSettings) : { ...defaultSettings };
}

const saveSettings = (newSettings) => {
    if (confirm('Saving settings will reload the page. Any unsaved changes will be lost. Continue?')) {
        const oldSettings = loadSettings();
        const settings = { ...oldSettings, ...newSettings };
        localStorage.setItem('packingVisualizerSettings', JSON.stringify(settings));
        
        const activeSceneName = localStorage.getItem('lastActiveScene');
    
        if (activeSceneName) {
            const savedScenes = JSON.parse(localStorage.getItem('packingVisualizerScenes') || '{}');
            const activeScene = savedScenes[activeSceneName];
            if (Object.keys(activeScene || {})) {
                const fullSceneData = {
                    ...activeScene,
                    settings: newSettings
                };
            
                savedScenes[activeSceneName] = fullSceneData;
                localStorage.setItem('packingVisualizerScenes', JSON.stringify(savedScenes));
            }
        }
        window.location.reload(); // Reload to apply new settings
    }
}

// Since we're loading Three.js from CDN, we need to use it globally
class PackingCalculator {
    constructor(surfaceWidth = 1000, surfaceDepth = 1200) {
        this.surfaceWidth = surfaceWidth;  // in mm
        this.surfaceDepth = surfaceDepth;  // in mm
    }

    calculateStandardDeviation(values) {
        const n = values.length;
        const mean = values.reduce((a, b) => a + b) / n;
        const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
        return Math.sqrt(variance);
    }

    validateStandardDeviations(calculatedStdDevs, targetStdDevs) {
        const warnings = [];
        
        if (calculatedStdDevs.x > targetStdDevs.x) {
            warnings.push(`X-axis standard deviation (${calculatedStdDevs.x.toFixed(2)}) exceeds target (${targetStdDevs.x})`);
        }
        if (calculatedStdDevs.y > targetStdDevs.y) {
            warnings.push(`Y-axis standard deviation (${calculatedStdDevs.y.toFixed(2)}) exceeds target (${targetStdDevs.y})`);
        }
        if (calculatedStdDevs.z > targetStdDevs.z) {
            warnings.push(`Z-axis standard deviation (${calculatedStdDevs.z.toFixed(2)}) exceeds target (${targetStdDevs.z})`);
        }

        return warnings;
    }

    calculateContainer(itemDimensions, arrangement, containerGaps, itemGaps) {
        const { width, depth, height } = itemDimensions;
        const { rows, columns, layers } = arrangement;
        const { x: containerGapX, y: containerGapY, z: containerGapZ } = containerGaps;
        const { x: itemGapX, y: itemGapY, z: itemGapZ } = itemGaps;

        // Calculate effective item dimensions (including item gaps)
        const effectiveItemWidth = width + (2 * itemGapX);
        const effectiveItemHeight = height + (2 * itemGapY);
        const effectiveItemDepth = depth + (2 * itemGapZ);

        // Calculate inner container dimensions (with item gaps)
        const innerWidth = effectiveItemWidth * columns;
        const innerDepth = effectiveItemDepth * rows;
        const innerHeight = effectiveItemHeight * layers;

        // Calculate outer container dimensions (with container gaps)
        const containerWidth = innerWidth + (2 * containerGapX);
        const containerDepth = innerDepth + (2 * containerGapZ);
        const containerHeight = innerHeight + (2 * containerGapY);

        // Check surface constraints
        const exceedsSurface = containerWidth > this.surfaceWidth || 
                             containerDepth > this.surfaceDepth;

        return {
            dimensions: {
                item: {
                    width,
                    depth,
                    height
                },
                effectiveItem: {
                    width: effectiveItemWidth,
                    depth: effectiveItemDepth,
                    height: effectiveItemHeight
                },
                inner: {
                    width: innerWidth,
                    depth: innerDepth,
                    height: innerHeight
                },
                outer: {
                    width: containerWidth,
                    depth: containerDepth,
                    height: containerHeight
                }
            },
            containerGaps,
            itemGaps,
            exceedsSurface,
            totalItems: rows * columns * layers,
            arrangement,
            warnings: exceedsSurface ? 
                [`Container exceeds surface area of ${this.surfaceWidth}mm x ${this.surfaceDepth}mm`] : 
                []
        };
    }


    calculateItemPositions(itemDimensions, arrangement) {
        const positions = [];
        const { width, depth, height } = itemDimensions;
        const { rows, columns, layers } = arrangement;

        for (let layer = 0; layer < layers; layer++) {
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < columns; col++) {
                    positions.push({
                        x: col * width,
                        y: layer * height,
                        z: row * depth
                    });
                }
            }
        }

        return positions;
    }

    validateConfiguration(itemDimensions, arrangement) {
        const result = this.calculateContainer(itemDimensions, arrangement);
        const warnings = [];

        if (result.exceedsSurface) {
            warnings.push(`Container exceeds surface area of ${this.surfaceWidth}mm x ${this.surfaceDepth}mm`);
        }

        return {
            isValid: warnings.length === 0,
            warnings
        };
    }
}

class PackingVisualizer {
    constructor(containerId) {
        this.settings = loadSettings();
        this.itemColor = this.settings.itemColor;
        this.containerColor = this.settings.containerColor;
        this.container = document.getElementById(containerId);
        this.init();
        this.currentUnit = 'mm';
        this.addUnitToggle();
    }

    init() {
        // Setup scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf0f0f0);

        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            5000
        );
        this.camera.position.set(1000, 1000, 1000);
        this.camera.lookAt(0, 0, 0);

        // Setup renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);

        // Setup controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Add lighting
        this.addLights();
        this.addGround();
        this.animate();

        window.addEventListener('resize', () => this.onWindowResize(), false);
    }

    addUnitToggle() {
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'absolute top-4 right-4 flex gap-2'; // Changed to flex for multiple buttons
        controlsDiv.innerHTML = `
            <select id="unitToggle" class="bg-white border rounded px-2 py-1">
                <option value="mm">Millimeters (mm)</option>
                <option value="cm">Centimeters (cm)</option>
            </select>
            <button id="centerView" class="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">
                Center View
            </button>
        `;
        this.container.style.position = 'relative';
        this.container.appendChild(controlsDiv);
    
        document.getElementById('unitToggle').addEventListener('change', (e) => {
            this.currentUnit = e.target.value;
            this.updateStatsDisplay(this.lastPackingResult);
        });
    
        document.getElementById('centerView').addEventListener('click', () => {
            this.centerCamera();
        });
    }
    
    centerCamera() {
        if (!this.lastPackingResult) return;
    
        const { dimensions } = this.lastPackingResult;
        const { outer } = dimensions;
    
        // Calculate the center point of the container
        const centerX = outer.width/2;
        const centerY = outer.height/2;
        const centerZ = outer.depth/2;
    
        // Calculate camera position based on container size
        const maxDimension = Math.max(outer.width, outer.depth, outer.height);
        const distance = maxDimension * 2;
    
        // Position camera at an isometric view
        this.camera.position.set(
            centerX + distance,
            centerY + distance,
            centerZ + distance
        );
    
        // Point camera at the center of the container
        this.camera.lookAt(centerX, centerY, centerZ);
        this.controls.target.set(centerX, centerY, centerZ);
    
        // Update controls
        this.controls.update();
    }    

    convertUnit(value) {
        return this.currentUnit === 'cm' ? value / 10 : value;
    }

    getUnitString() {
        return this.currentUnit;
    }

    addDimensionLines(width, height, depth) {
        // Create dimension lines group
        const dimensionLines = new THREE.Group();
        
        // Helper function to create arrow
        const createArrow = (start, end, color) => {
            const direction = new THREE.Vector3().subVectors(end, start).normalize();
            const length = start.distanceTo(end);
            const arrowHelper = new THREE.ArrowHelper(
                direction,
                start,
                length,
                color,
                length * 0.1,
                length * 0.05
            );
            return arrowHelper;
        };

        // X dimension (width)
        dimensionLines.add(createArrow(
            new THREE.Vector3(0, -50, depth),
            new THREE.Vector3(width, -50, depth),
            0xff0000
        ));

        // Y dimension (height)
        dimensionLines.add(createArrow(
            new THREE.Vector3(-50, 0, depth),
            new THREE.Vector3(-50, height, depth),
            0x00ff00
        ));

        // Z dimension (depth)
        dimensionLines.add(createArrow(
            new THREE.Vector3(0, -50, 0),
            new THREE.Vector3(0, -50, depth),
            0x0000ff
        ));

        this.scene.add(dimensionLines);
    }
    
    addLabel(text, position, dimensions) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 512;  // Increased canvas size for better quality
        canvas.height = 128; // Increased canvas size for better quality
    
        // Calculate font size based on container dimensions
        const maxDimension = Math.max(dimensions.width, dimensions.height, dimensions.depth);
        const baseFontSize = Math.max(24, maxDimension / 10); // Minimum 24px, scales with size
    
        // Fill background
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
    
        // Draw text
        context.font = `bold ${baseFontSize}px Arial`;
        context.fillStyle = 'black';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width/2, canvas.height/2);
    
        // Create sprite
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
        });
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
    
        // Scale sprite size based on container size
        const spriteScale = maxDimension / 5;
        sprite.scale.set(spriteScale, spriteScale/4, 1);
    
        this.scene.add(sprite);
        return sprite;
    }
    

    visualizeStandardDeviations(standardDeviations, targetStdDevs) {
        const maxStdDev = Math.max(
            standardDeviations.x,
            standardDeviations.y,
            standardDeviations.z
        );

        // Create visualization at origin
        const stdDevGroup = new THREE.Group();

        // Helper function to create std dev visualization
        const createStdDevBar = (value, targetValue, position, color) => {
            const height = value;
            const geometry = new THREE.BoxGeometry(20, height, 20);
            const material = new THREE.MeshPhongMaterial({
                color: value > targetValue ? 0xff0000 : 0x00ff00,
                transparent: true,
                opacity: 0.6
            });
            const bar = new THREE.Mesh(geometry, material);
            bar.position.copy(position);
            bar.position.y += height / 2;

            // Add target line
            const targetGeometry = new THREE.BoxGeometry(30, 2, 30);
            const targetMaterial = new THREE.MeshPhongMaterial({ color: 0xffff00 });
            const targetLine = new THREE.Mesh(targetGeometry, targetMaterial);
            targetLine.position.copy(position);
            targetLine.position.y = targetValue;

            const group = new THREE.Group();
            group.add(bar);
            group.add(targetLine);
            return group;
        };

        // Create bars for each axis
        stdDevGroup.add(createStdDevBar(
            standardDeviations.x,
            targetStdDevs.x,
            new THREE.Vector3(-100, 0, 0),
            0xff0000
        ));
        stdDevGroup.add(createStdDevBar(
            standardDeviations.y,
            targetStdDevs.y,
            new THREE.Vector3(0, 0, 0),
            0x00ff00
        ));
        stdDevGroup.add(createStdDevBar(
            standardDeviations.z,
            targetStdDevs.z,
            new THREE.Vector3(100, 0, 0),
            0x0000ff
        ));

        // Add labels
        this.addLabel("X StdDev", new THREE.Vector3(-100, -30, 0));
        this.addLabel("Y StdDev", new THREE.Vector3(0, -30, 0));
        this.addLabel("Z StdDev", new THREE.Vector3(100, -30, 0));

        stdDevGroup.position.set(0, 0, -200);
        this.scene.add(stdDevGroup);
    }


    addLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1000, 1000, 1000);
        this.scene.add(directionalLight);
    }

    addGround() {
        // Add grid helper
        const gridHelper = new THREE.GridHelper(2000, 20);
        this.scene.add(gridHelper);

        // Add surface area outline
        const geometry = new THREE.BoxGeometry(1000, 1, 1200);
        const material = new THREE.MeshBasicMaterial({
            color: 0x966b08,
            transparent: true,
            opacity: 0.8
        });
        const surface = new THREE.Mesh(geometry, material);
        surface.position.y = -0.5;
        this.scene.add(surface);
    }

    addArrowWithLabel(text, start, end, color, dimensions) {
        // Create arrow
        const direction = new THREE.Vector3().subVectors(end, start).normalize();
        const length = start.distanceTo(end);
        const arrowHelper = new THREE.ArrowHelper(
            direction,
            start,
            length,
            color,
            length * 0.1,
            length * 0.05
        );
        this.scene.add(arrowHelper);
    
        // Add label at midpoint with dimensions
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        midpoint.y -= dimensions.height / 20; // Scale offset with container height
        this.addLabel(text, midpoint, dimensions);
    }    

    updateVisualization(packingResult) {
        this.lastPackingResult = packingResult;
        this.clearItems();
        const { dimensions, containerGaps, itemGaps } = packingResult;
        const { inner, outer } = dimensions;
    
        // Create outer container with configured color
        const outerGeometry = new THREE.BoxGeometry(
            outer.width, 
            outer.height, 
            outer.depth   
        );
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.containerColor),
            transparent: true,
            opacity: 0.3,
            wireframe: false,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
        });
        
        const outerContainer = new THREE.Mesh(outerGeometry, outerMaterial);
        outerContainer.position.set(outer.width/2, outer.height/2, outer.depth/2);
        this.scene.add(outerContainer);

        // Create the outline for the outer container
        const outerEdgesGeometry = new THREE.EdgesGeometry(outerGeometry);
        const outerEdgesMaterial = new THREE.LineBasicMaterial({
            color: 0x000000,
            linewidth: 2,
        });
        const outerWireframe = new THREE.LineSegments(outerEdgesGeometry, outerEdgesMaterial);
        outerWireframe.position.copy(outerContainer.position);
        this.scene.add(outerWireframe);
    
        // Create inner container
        const innerGeometry = new THREE.BoxGeometry(
            inner.width, 
            inner.height, 
            inner.depth
        );
        const innerMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.containerColor),
            transparent: true,
            opacity: 0,
            wireframe: false,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
        });
        const innerContainer = new THREE.Mesh(innerGeometry, innerMaterial);
        innerContainer.position.set(
            outer.width/2,
            outer.height/2,
            outer.depth/2
        );
        this.scene.add(innerContainer);
    
        // Add items with the correct offset (gap)
        const { rows, columns, layers } = packingResult.arrangement;
        const itemWidth = inner.width / columns;
        const itemHeight = inner.height / layers;
        const itemDepth = inner.depth / rows;
    
        // Calculate starting position (including gap)
        const startX = containerGaps.x;
        const startY = containerGaps.y;
        const startZ = containerGaps.z;
    
        // Create items
        for (let layer = 0; layer < layers; layer++) {
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < columns; col++) {
                    const itemGroup = this.createItemWithOutline(
                        itemWidth - (2 * itemGaps.x),
                        itemHeight - (2 * itemGaps.y),
                        itemDepth - (2 * itemGaps.z)
                    );
                    
                    itemGroup.position.set(
                        startX + (col * itemWidth) + (itemWidth/2),
                        startY + (layer * itemHeight) + (itemHeight/2),
                        startZ + (row * itemDepth) + (itemDepth/2)
                    );
                    
                    this.scene.add(itemGroup);
                }
            }
        }
    
        // Add dimension lines with gaps labeled
        this.addDimensionLinesWithGaps(outer, containerGaps);
    
        // Update camera position
        const maxDimension = Math.max(outer.width, outer.depth, outer.height);
        this.camera.position.set(maxDimension * 2, maxDimension * 2, maxDimension * 2);
        this.camera.lookAt(outer.width/2, outer.height/2, outer.depth/2);
        this.controls.target.set(outer.width/2, outer.height/2, outer.depth/2);
    
        // Update stats display
        this.updateStatsDisplay(packingResult);
    }

    createItemWithOutline(width, height, depth) {
        // Create item geometry
        const itemGeometry = new THREE.BoxGeometry(width, height, depth);
        
        // Create item mesh with semi-transparent material using configured color
        const itemMaterial = new THREE.MeshPhongMaterial({
            color: new THREE.Color(this.itemColor),
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide
        });
        const item = new THREE.Mesh(itemGeometry, itemMaterial);

        // Create wireframe outline
        const edgesGeometry = new THREE.EdgesGeometry(itemGeometry);
        const edgesMaterial = new THREE.LineBasicMaterial({ 
            color: 0x000000, 
            linewidth: 2,
            side: THREE.DoubleSide
        });
        const wireframe = new THREE.LineSegments(edgesGeometry, edgesMaterial);

        // Group item and its wireframe
        const itemGroup = new THREE.Group();
        itemGroup.add(item);
        itemGroup.add(wireframe);

        return itemGroup;
    }


    addDimensionLinesWithGaps(dimensions, gaps) {
        const { width, depth, height } = dimensions;
        const unit = this.getUnitString();
        
        const formatDimensionText = (value, dimensionKey) => {
            const formattedValue = this.convertUnit(value).toFixed(1);
            return `${window.translationManager.translate(dimensionKey)}: ${formattedValue}${unit}`;
        };
        
        // Add arrows for total dimensions
        this.addArrowWithLabel(
            formatDimensionText(width, 'settings.width'),
            new THREE.Vector3(0, -50, depth),
            new THREE.Vector3(width, -50, depth),
            0xff0000,
            dimensions
        );
    
        this.addArrowWithLabel(
            formatDimensionText(height, 'settings.height'),
            new THREE.Vector3(-50, 0, depth),
            new THREE.Vector3(-50, height, depth),
            0x00ff00,
            dimensions
        );
    
        this.addArrowWithLabel(
            formatDimensionText(depth, 'settings.depth'),
            new THREE.Vector3(0, -50, 0),
            new THREE.Vector3(0, -50, depth),
            0x0000ff,
            dimensions
        );
    }

    addDimensionLabel(text, position) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = '24px Arial';
        context.fillStyle = 'black';
        context.textAlign = 'center';
        context.fillText(text, canvas.width/2, canvas.height/2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        sprite.scale.set(100, 25, 1);
        this.scene.add(sprite);
    }

    updateStatsDisplay(packingResult) {
        if (!packingResult) return;
        
        const { dimensions, containerGaps, itemGaps, totalItems } = packingResult;
        const { item, effectiveItem, inner, outer } = dimensions;
        const unit = this.getUnitString();
    
        const formatValue = (value) => {
            const converted = this.convertUnit(value);
            return `${converted.toFixed(1)} ${unit}`;
        };
    
        let statsDiv = document.getElementById('packingStats');
        if (!statsDiv) {
            statsDiv = document.createElement('div');
            statsDiv.id = 'packingStats';
            statsDiv.className = 'bg-white p-8 rounded-lg shadow-md mt-4';
            document.querySelector('#container').insertAdjacentElement('afterend', statsDiv);
        }
    
        statsDiv.innerHTML = `
            <h3 class="font-bold text-lg mb-2" data-translate="stats.packingStats">Packing Statistics</h3>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <p><strong data-translate="stats.baseItemDimensions">Base Item Dimensions</strong></p>
                    <ul class="list-disc pl-5">
                        <li><span data-translate="settings.width">Width</span>: ${formatValue(item.width)}</li>
                        <li><span data-translate="settings.depth">Depth</span>: ${formatValue(item.depth)}</li>
                        <li><span data-translate="settings.height">Height</span>: ${formatValue(item.height)}</li>
                    </ul>
                </div>
                <div>
                    <p><strong data-translate="stats.effectiveItemDimensions">Effective Item Dimensions</strong></p>
                    <ul class="list-disc pl-5">
                        <li><span data-translate="settings.width">Width</span>: ${formatValue(effectiveItem.width)}</li>
                        <li><span data-translate="settings.depth">Depth</span>: ${formatValue(effectiveItem.depth)}</li>
                        <li><span data-translate="settings.height">Height</span>: ${formatValue(effectiveItem.height)}</li>
                    </ul>
                </div>
                <div>
                    <p><strong data-translate="stats.innerContainerDimensions">Inner Container Dimensions</strong></p>
                    <ul class="list-disc pl-5">
                        <li><span data-translate="settings.width">Width</span>: ${formatValue(inner.width)}</li>
                        <li><span data-translate="settings.depth">Depth</span>: ${formatValue(inner.depth)}</li>
                        <li><span data-translate="settings.height">Height</span>: ${formatValue(inner.height)}</li>
                    </ul>
                </div>
                <div>
                    <p><strong data-translate="stats.outerContainerDimensions">Outer Container Dimensions</strong></p>
                    <ul class="list-disc pl-5">
                        <li><span data-translate="settings.width">Width</span>: ${formatValue(outer.width)}</li>
                        <li><span data-translate="settings.depth">Depth</span>: ${formatValue(outer.depth)}</li>
                        <li><span data-translate="settings.height">Height</span>: ${formatValue(outer.height)}</li>
                    </ul>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4 mt-2">
                <div>
                    <p><strong data-translate="stats.containerGaps">Container Gaps</strong></p>
                    <ul class="list-disc pl-5">
                        <li><span data-translate="main.xAxis">X Axis</span>: ${formatValue(containerGaps.x)}</li>
                        <li><span data-translate="main.yAxis">Y Axis</span>: ${formatValue(containerGaps.y)}</li>
                        <li><span data-translate="main.zAxis">Z Axis</span>: ${formatValue(containerGaps.z)}</li>
                    </ul>
                </div>
                <div>
                    <p><strong data-translate="stats.itemGaps">Item Gaps</strong></p>
                    <ul class="list-disc pl-5">
                        <li><span data-translate="main.xAxis">X Axis</span>: ${formatValue(itemGaps.x)}</li>
                        <li><span data-translate="main.yAxis">Y Axis</span>: ${formatValue(itemGaps.y)}</li>
                        <li><span data-translate="main.zAxis">Z Axis</span>: ${formatValue(itemGaps.z)}</li>
                    </ul>
                </div>
            </div>
            <p class="mt-2"><strong data-translate="stats.totalItems">Total Items</strong>: ${totalItems}</p>
        `;
    
        // Trigger translation update for the new content
        window.translationManager.updatePageTranslations();
    }


    clearItems() {
        this.scene.children = this.scene.children.filter(child => 
            child.type === 'GridHelper' || 
            child.type === 'AmbientLight' || 
            child.type === 'DirectionalLight'
        );
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    captureImage() {
        // Render the scene
        this.renderer.render(this.scene, this.camera);
        
        // Get the canvas element and convert to data URL
        const canvas = this.renderer.domElement;
        
        try {
            // Ensure we're preserving the alpha channel
            return canvas.toDataURL('image/png', 1.0);
        } catch (error) {
            console.error('Error capturing image:', error);
            return null;
        }
    }

    exportScene() {
        try {
            const exporter = new GLTFExporter();
            
            return new Promise((resolve, reject) => {
                exporter.parse(
                    this.scene, 
                    (gltf) => {
                        try {
                            const output = JSON.stringify(gltf, null, 2);
                            const blob = new Blob([output], { type: 'application/json' });
                            resolve(blob);
                        } catch (e) {
                            reject(e);
                        }
                    },
                    (error) => {
                        reject(error);
                    },
                    { binary: false }
                );
            });
        } catch (error) {
            console.error('Error in exportScene:', error);
            throw error;
        }
    }
}

class SettingsManager {
    constructor() {
        this.settings = loadSettings();
        this.translationManager = new TranslationManager();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const settingsBtn = document.getElementById('settingsBtn');
        const saveSettingsBtn = document.getElementById('saveSettings');
        const settingsModal = document.getElementById('settingsModal');

        // Populate settings form with current values
        this.populateSettingsForm();

        settingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('hidden');
        });

        saveSettingsBtn.addEventListener('click', () => {
            const newSettings = {
                language: document.getElementById('language').value,
                defaultUnit: document.getElementById('defaultUnit').value,
                surfaceWidth: Number(document.getElementById('surfaceWidth').value),
                surfaceDepth: Number(document.getElementById('surfaceDepth').value),
                itemColor: document.getElementById('itemColor').value,
                containerColor: document.getElementById('containerColor').value
            };
            saveSettings(newSettings);
        });
        document.getElementById('language').addEventListener('change', (e) => {
            this.translationManager.setLanguage(e.target.value);
        });
    }

    populateSettingsForm() {
        document.getElementById('language').value = this.settings.language;
        document.getElementById('defaultUnit').value = this.settings.defaultUnit;
        document.getElementById('surfaceWidth').value = this.settings.surfaceWidth;
        document.getElementById('surfaceDepth').value = this.settings.surfaceDepth;
        document.getElementById('itemColor').value = this.settings.itemColor;
        document.getElementById('containerColor').value = this.settings.containerColor;
    }
}

// Add Scene Manager class
class SceneManager {
    constructor() {
        this.scenes = this.loadScenes();
        this.setupEventListeners();
        this.updateSavedItemsList();
        this.applyLastActiveScene();
    }

    loadScenes() {
        const exampleScenes = '{"פריט לדוגמה":{"itemWidth":"95","itemDepth":"160","itemHeight":"55","rows":"3","columns":"3","layers":"3","containerGapX":"5","containerGapY":"5","containerGapZ":"5","itemGapX":"1","itemGapY":"1","itemGapZ":"1","settings":{"itemColor":"#4287f5","containerColor":"#bc9166","surfaceWidth":1000,"surfaceDepth":1200,"defaultUnit":"mm","language":"he"}}}'
        const sceneData = Object.keys(JSON.parse(localStorage.getItem('packingVisualizerScenes')) || {});
        const sceneDataLength = Object.keys(sceneData || {}).length;
        return (sceneDataLength ? sceneData : JSON.parse(exampleScenes));
    }

    setupEventListeners() {
        const saveSceneBtn = document.getElementById('saveScene');
        if (saveSceneBtn) {
            saveSceneBtn.addEventListener('click', () => {
                const name = document.getElementById('sceneName').value;
                const formData = this.captureFormData();
                this.saveScene(name, formData);
            });
        }
    }

    captureFormData() {
        const formData = {};
        const formElements = [
            'itemWidth', 'itemDepth', 'itemHeight',
            'rows', 'columns', 'layers',
            'containerGapX', 'containerGapY', 'containerGapZ',
            'itemGapX', 'itemGapY', 'itemGapZ'
        ];

        formElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                formData[id] = element.value;
            }
        });

        return formData;
    }

    populateForm(data) {
        if (!data) return;
        
        // Populate form fields
        Object.keys(data).forEach(key => {
            if (key !== 'settings') { // Skip settings object
                const element = document.getElementById(key);
                if (element) {
                    element.value = data[key];
                }
            }
        });
        
        // If there are settings, apply them
        if (data.settings) {
            this.applySettings(data.settings);
        }
    }

    saveScene(name, sceneData) {
        if (!name) {
            alert('Please enter a scene name');
            return;
        }

        // Get current settings
        const currentSettings = {
            itemColor: document.getElementById('itemColor').value,
            containerColor: document.getElementById('containerColor').value,
            surfaceWidth: Number(document.getElementById('surfaceWidth').value),
            surfaceDepth: Number(document.getElementById('surfaceDepth').value),
            defaultUnit: document.getElementById('defaultUnit').value,
            language: document.getElementById('language').value
        };
        
        // Combine form data with settings
        const fullSceneData = {
            ...sceneData,
            settings: currentSettings
        };
        
        this.scenes[name] = fullSceneData;
        localStorage.setItem('packingVisualizerScenes', JSON.stringify(this.scenes));
        localStorage.setItem('lastActiveScene', name);
        this.updateSavedItemsList();
    }

    handleSceneLoad(name) {
        if (confirm('Loading a new scene will discard any unsaved changes and reload the page. Continue?')) {
            localStorage.setItem('lastActiveScene', name);
            document.getElementById('sceneName').value = name;
            window.location.reload();
        }
    }

    applyLastActiveScene() {
        const lastActiveScene = localStorage.getItem('lastActiveScene');
        if (lastActiveScene && this.scenes[lastActiveScene]) {
            const sceneData = this.scenes[lastActiveScene];
            this.populateForm(sceneData);
            document.getElementById('sceneName').value = lastActiveScene;
            // Trigger visualization update after a short delay to ensure DOM is ready
            setTimeout(() => {
                const form = document.getElementById('packingForm');
                if (form) {
                    form.dispatchEvent(new Event('submit'));
                }
            }, 100);
        }
    }

    applySettings(settings) {
        if (!settings) return;

        const settingElements = {
            itemColor: document.getElementById('itemColor'),
            containerColor: document.getElementById('containerColor'),
            surfaceWidth: document.getElementById('surfaceWidth'),
            surfaceDepth: document.getElementById('surfaceDepth'),
            defaultUnit: document.getElementById('defaultUnit'),
            language: document.getElementById('language')
        };

        Object.entries(settingElements).forEach(([key, element]) => {
            if (element && settings[key] !== undefined) {
                element.value = settings[key];
            }
        });
    }

    handleSceneDelete(name) {
        if (confirm(`Are you sure you want to delete "${name}"?`)) {
            delete this.scenes[name];
            localStorage.setItem('packingVisualizerScenes', JSON.stringify(this.scenes));
            
            if (localStorage.getItem('lastActiveScene') === name) {
                localStorage.removeItem('lastActiveScene');
            }
            
            this.updateSavedItemsList();
        }
    }

    updateSavedItemsList() {
        const savedItemsContainer = document.getElementById('savedItems');
        if (!savedItemsContainer) return;
        
        savedItemsContainer.innerHTML = '';
        
        Object.entries(this.scenes).forEach(([name, data]) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'flex justify-between items-center p-2 bg-gray-50 rounded hover:bg-gray-100';
            
            const settings = data.settings || {};
            
            itemDiv.innerHTML = `
                <div>
                    <span class="font-medium">${name}</span>
                    <div class="text-xs text-gray-500 mt-1">
                        ${settings.defaultUnit || 'mm'} | 
                        <span data-translate="main.size">Size</span>: ${data.itemWidth}×${data.itemDepth}×${data.itemHeight} | 
                        <span data-translate="main.layout">Layout</span>: ${data.rows}×${data.columns}×${data.layers}
                    </div>
                </div>
                <div class="flex space-x-2">
                    <button class="load-scene text-blue-600 hover:text-blue-800" data-translate="main.load">Load</button>
                </div>
                <button class="delete-scene text-red-600 hover:text-red-800" data-translate="main.delete">Delete</button>
            `;
            
            const loadBtn = itemDiv.querySelector('.load-scene');
            const deleteBtn = itemDiv.querySelector('.delete-scene');
            
            loadBtn.addEventListener('click', () => this.handleSceneLoad(name));
            deleteBtn.addEventListener('click', () => this.handleSceneDelete(name));
            
            savedItemsContainer.appendChild(itemDiv);
        });
    
        // Trigger translation update for the new content
        window.translationManager.updatePageTranslations();
    }
}

class TranslationManager {
    constructor() {
        this.translations = null;
        this.currentSettings = loadSettings();
        this.currentLanguage = this.currentSettings.language || 'en';
        this.loadTranslations();
    }

    async loadTranslations() {
        try {
            const response = await fetch('./translations.json');
            this.translations = await response.json();
            this.updatePageTranslations();
        } catch (error) {
            console.error('Failed to load translations:', error);
        }
    }

    setLanguage(language) {
        if (this.translations && this.translations[language]) {
            this.currentLanguage = language;
            localStorage.setItem('packingVisualizerLanguage', language);
            this.updatePageTranslations();
            // Update document direction for RTL support
            document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
            return true;
        }
        return false;
    }

    translate(key) {
        if (!this.translations || !this.currentLanguage) return key;
        
        const keys = key.split('.');
        let value = this.translations[this.currentLanguage];
        
        for (const k of keys) {
            if (!value || !value[k]) return key;
            value = value[k];
        }
        
        return value;
    }

    updatePageTranslations() {
        // Update all elements with data-translate attribute
        document.querySelectorAll('[data-translate]').forEach(element => {
            const key = element.getAttribute('data-translate');
            const translatedText = this.translate(key);
            element.textContent = translatedText;
        });

        // Update all placeholders with data-translate-placeholder attribute
        document.querySelectorAll('[data-translate-placeholder]').forEach(element => {
            const key = element.getAttribute('data-translate-placeholder');
            const translatedText = this.translate(key);
            element.placeholder = translatedText;
        });

        // Update document title
        const titleElement = document.querySelector('title[data-translate]');
        if (titleElement) {
            document.title = this.translate(titleElement.getAttribute('data-translate'));
        }

        // Update units in selects
        const unitSelect = document.getElementById('defaultUnit');
        if (unitSelect) {
            Array.from(unitSelect.options).forEach(option => {
                const key = option.getAttribute('data-translate');
                if (key) {
                    option.text = this.translate(key);
                }
            });
        }

        // Update stats section if it exists
        this.updateStatsSection();
    }

    updateStatsSection() {
        const statsDiv = document.getElementById('packingStats');
        if (!statsDiv) return;

        // Update main stats title
        const statsTitle = statsDiv.querySelector('h3');
        if (statsTitle) {
            statsTitle.textContent = this.translate('stats.packingStats');
        }

        // Update section titles
        const sections = {
            'baseItemDimensions': 'stats.baseItemDimensions',
            'effectiveItemDimensions': 'stats.effectiveItemDimensions',
            'innerContainerDimensions': 'stats.innerContainerDimensions',
            'outerContainerDimensions': 'stats.outerContainerDimensions',
            'containerGaps': 'stats.containerGaps',
            'itemGaps': 'stats.itemGaps'
        };

        Object.entries(sections).forEach(([className, translationKey]) => {
            const sectionTitle = statsDiv.querySelector(`[data-section="${className}"]`);
            if (sectionTitle) {
                sectionTitle.textContent = this.translate(translationKey);
            }
        });

        // Update total items text
        const totalItemsElement = statsDiv.querySelector('[data-total-items]');
        if (totalItemsElement) {
            const totalItems = totalItemsElement.getAttribute('data-total-items');
            totalItemsElement.textContent = `${this.translate('stats.totalItems')}: ${totalItems}`;
        }
    }

    // Helper method to update measurements with current unit
    updateMeasurements() {
        document.querySelectorAll('[data-measurement]').forEach(element => {
            const value = element.getAttribute('data-measurement');
            const unit = this.translate('units.' + this.currentUnit);
            element.textContent = `${value} ${unit}`;
        });
    }
}

class PackingApp {
    constructor() {
        this.settings = new SettingsManager();
        this.calculator = new PackingCalculator(
            this.settings.settings.surfaceWidth,
            this.settings.settings.surfaceDepth
        );
        this.visualizer = new PackingVisualizer(
            'container',
            this.settings.settings.itemColor,
            this.settings.settings.containerColor
        );
        this.sceneManager = new SceneManager();
        this.setupEventListeners();
    }

    setupEventListeners() {
        const form = document.getElementById('packingForm');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.updatePacking();
        });

        document.getElementById('downloadImage').addEventListener('click', () => this.downloadImage());
        document.getElementById('downloadScene').addEventListener('click', () => this.downloadScene());
    }

    updatePacking() {
        const itemDimensions = {
            width: Number(document.getElementById('itemWidth').value),
            depth: Number(document.getElementById('itemDepth').value),
            height: Number(document.getElementById('itemHeight').value)
        };

        const arrangement = {
            rows: Number(document.getElementById('rows').value),
            columns: Number(document.getElementById('columns').value),
            layers: Number(document.getElementById('layers').value)
        };

        const containerGaps = {
            x: Number(document.getElementById('containerGapX').value),
            y: Number(document.getElementById('containerGapY').value),
            z: Number(document.getElementById('containerGapZ').value)
        };

        const itemGaps = {
            x: Number(document.getElementById('itemGapX').value),
            y: Number(document.getElementById('itemGapY').value),
            z: Number(document.getElementById('itemGapZ').value)
        };

        // Calculate packing with both container and item gaps
        const packingResult = this.calculator.calculateContainer(
            itemDimensions, 
            arrangement, 
            containerGaps,
            itemGaps
        );
        
        // Update warnings
        this.updateWarnings(packingResult.warnings);

        // Update visualization
        this.visualizer.updateVisualization(packingResult);
    }


    updateWarnings(warnings) {
        const warningsDiv = document.getElementById('warnings');
        const warningsText = warningsDiv.querySelector('p');

        if (warnings && warnings.length > 0) {
            warningsText.textContent = warnings.join('\n');
            warningsDiv.classList.remove('hidden');
        } else {
            warningsDiv.classList.add('hidden');
        }
    }

    async downloadImage() {
        const dataUrl = this.visualizer.captureImage();
        if (!dataUrl) {
            alert('Failed to capture image');
            return;
        }
        
        try {
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = 'packing-visualization.png';
            document.body.appendChild(link);  // Needed for Firefox
            link.click();
            document.body.removeChild(link);  // Clean up
        } catch (error) {
            console.error('Error downloading image:', error);
            alert('Failed to download image');
        }
    }

    async downloadScene() {
        try {
            const blob = await this.visualizer.exportScene();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'packing-scene.gltf';
            document.body.appendChild(link); // Required for Firefox
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading scene:', error);
            alert('Failed to download scene. Please try again.');
        }
    }
}

window.translationManager = new TranslationManager();
// Initialize the application when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new PackingApp();
});
