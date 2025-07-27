// stars.js - Animated floating stars background
(function() {
    // Store floating element data for line drawing
    let floatingElementsData = [];
    let linesCanvas = null;
    function createFloatingElements() {
        const container = document.getElementById('backgroundAnimation');
        if (!container) return;
        container.innerHTML = '';
        // Remove old canvas if present
        if (linesCanvas && linesCanvas.parentNode) linesCanvas.parentNode.removeChild(linesCanvas);
        // Create canvas for lines
        linesCanvas = document.createElement('canvas');
        linesCanvas.style.position = 'absolute';
        linesCanvas.style.top = '0';
        linesCanvas.style.left = '0';
        linesCanvas.style.width = '100vw';
        linesCanvas.style.height = '100vh';
        linesCanvas.style.pointerEvents = 'none';
        linesCanvas.style.zIndex = '2';
        linesCanvas.width = window.innerWidth;
        linesCanvas.height = window.innerHeight;
        container.appendChild(linesCanvas);
        const elementCount = window.innerWidth < 768 ? 15 : 25;
        // Define shape groups
        const shapeGroups = [
            {
                // Classic small stars
                shapes: ['circle'],
                sizeRange: [6, 18],
                opacityRange: [0.3, 0.7],
                color: 'var(--accent-purple, #ccbcfc)'
            },
            {
                // Large, soft glowing orbs
                shapes: ['circle'],
                sizeRange: [24, 48],
                opacityRange: [0.12, 0.25],
                color: 'rgba(204,188,252,0.7)'
            },
            {
                // Diamonds
                shapes: ['diamond'],
                sizeRange: [12, 28],
                opacityRange: [0.2, 0.5],
                color: 'var(--accent-purple, #ccbcfc)'
            },
            {
                // Stars (4-point)
                shapes: ['star'],
                sizeRange: [10, 22],
                opacityRange: [0.3, 0.6],
                color: 'white'
            },
            {
                // Rectangles
                shapes: ['rect'],
                sizeRange: [8, 20],
                opacityRange: [0.15, 0.4],
                color: 'var(--accent-purple, #ccbcfc)'
            }
        ];
        // Pick a random group for this batch
        const group = shapeGroups[Math.floor(Math.random() * shapeGroups.length)];
        floatingElementsData = [];
        for (let i = 0; i < elementCount; i++) {
            const shape = group.shapes[Math.floor(Math.random() * group.shapes.length)];
            const element = document.createElement('div');
            element.className = 'floating-element';
            // Random position
            const leftPercent = Math.random() * 100;
            const topPercent = Math.random() * 100;
            element.style.left = leftPercent + '%';
            element.style.top = topPercent + '%';
            // Animation
            const animDelay = Math.random() * 6;
            const animDuration = 4 + Math.random() * 4;
            element.style.animationDelay = animDelay + 's';
            element.style.animationDuration = animDuration + 's';
            const size = group.sizeRange[0] + Math.random() * (group.sizeRange[1] - group.sizeRange[0]);
            element.style.width = size + 'px';
            element.style.height = size + 'px';
            const opacity = group.opacityRange[0] + Math.random() * (group.opacityRange[1] - group.opacityRange[0]);
            element.style.opacity = opacity;
            element.style.background = group.color;
            // Shape rendering
            if (shape === 'circle') {
                element.style.borderRadius = '50%';
                element.style.transform = '';
            } else if (shape === 'diamond') {
                element.style.borderRadius = '0';
                element.style.transform = 'rotate(45deg)';
            } else if (shape === 'star') {
                element.style.background = 'none';
                element.style.borderRadius = '0';
                element.style.position = 'absolute';
                // Use SVG for star shape
                const svgNS = 'http://www.w3.org/2000/svg';
                const svg = document.createElementNS(svgNS, 'svg');
                svg.setAttribute('width', size);
                svg.setAttribute('height', size);
                svg.style.position = 'absolute';
                svg.style.top = '0';
                svg.style.left = '0';
                svg.style.pointerEvents = 'none';
                const star = document.createElementNS(svgNS, 'polygon');
                // 4-point star
                const points = [
                    [size/2, 0],
                    [size*0.65, size*0.35],
                    [size, size/2],
                    [size*0.65, size*0.65],
                    [size/2, size],
                    [size*0.35, size*0.65],
                    [0, size/2],
                    [size*0.35, size*0.35]
                ].map(p => p.join(",")).join(" ");
                star.setAttribute('points', points);
                star.setAttribute('fill', group.color);
                star.setAttribute('opacity', opacity);
                svg.appendChild(star);
                element.appendChild(svg);
            } else if (shape === 'rect') {
                element.style.borderRadius = '0.2em';
                element.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
            }
            container.appendChild(element);
            // Store for line drawing
            floatingElementsData.push({
                el: element,
                leftPercent,
                topPercent,
                size,
                animDelay,
                animDuration
            });
        }
        // Start animation frame for lines
        requestAnimationFrame(drawLinesBetweenElements);
    }

    // Draw lines between close elements
    function drawLinesBetweenElements() {
        if (!linesCanvas) return;
        const ctx = linesCanvas.getContext('2d');
        ctx.clearRect(0, 0, linesCanvas.width, linesCanvas.height);
        const now = performance.now() / 1000;
        // Get current positions of all elements (simulate float animation)
        const positions = floatingElementsData.map(data => {
            // Reproduce the float animation: float 6s ease-in-out infinite
            // We'll use the same keyframes: 0%,100%: translateY(0), 50%: translateY(-20px)
            // But duration is per element
            const t = ((now - data.animDelay) % data.animDuration) / data.animDuration;
            let translateY = 0;
            if (t < 0.5) {
                translateY = -40 * Math.sin(Math.PI * t); // -20px at t=0.5
            } else {
                translateY = -40 * Math.sin(Math.PI * (1-t));
            }
            const x = (data.leftPercent / 100) * window.innerWidth + data.size/2;
            const y = (data.topPercent / 100) * window.innerHeight + data.size/2 + translateY/2;
            return {x, y};
        });
        // Draw lines between close points
        const maxDist = Math.max(window.innerWidth, window.innerHeight) / 7; // threshold for line
        for (let i = 0; i < positions.length; i++) {
            for (let j = i+1; j < positions.length; j++) {
                const dx = positions[i].x - positions[j].x;
                const dy = positions[i].y - positions[j].y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < maxDist) {
                    ctx.save();
                    ctx.globalAlpha = 0.18 * (1 - dist/maxDist);
                    ctx.strokeStyle = '#ccbcfc';
                    ctx.lineWidth = 2.8;
                    ctx.beginPath();
                    ctx.moveTo(positions[i].x, positions[i].y);
                    ctx.lineTo(positions[j].x, positions[j].y);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }
        requestAnimationFrame(drawLinesBetweenElements);
    }
    document.addEventListener('DOMContentLoaded', createFloatingElements);
    window.addEventListener('resize', () => {
        clearTimeout(window._starsResizeTimeout);
        window._starsResizeTimeout = setTimeout(createFloatingElements, 150);
    });
    // Expose for manual re-creation if needed
    window.createFloatingElements = createFloatingElements;
})();
