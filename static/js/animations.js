/**
 * Premium UI Animations for TimelineAi
 * Features:
 * 1. WebGL Fluid Orb Background (Shader)
 * 2. Confetti Particle Cursor (Canvas)
 */

class AnimationManager {
    constructor() {
        this.initFluidBackground();
        this.initParticleCursor();
    }

    initFluidBackground() {
        const canvas = document.getElementById('bgCanvas');
        if (!canvas) return;

        const gl = canvas.getContext('webgl');
        if (!gl) return;

        // Resize handler
        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            gl.viewport(0, 0, canvas.width, canvas.height);
        };
        window.addEventListener('resize', resize);
        resize();

        // Vertex Shader (Simple Quad)
        const vsSource = `
            attribute vec2 position;
            varying vec2 vUv;
            void main() {
                vUv = position * 0.5 + 0.5;
                gl_Position = vec4(position, 0.0, 1.0);
            }
        `;

        // Fragment Shader (Fluid Orb)
        const fsSource = `
            precision mediump float;
            uniform float u_time;
            uniform vec2 u_resolution;
            uniform vec2 u_mouse;
            varying vec2 vUv;

            // Simple noise function
            float noise(vec2 p) {
                return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
            }

            void main() {
                vec2 st = gl_FragCoord.xy / u_resolution.xy;
                st.x *= u_resolution.x / u_resolution.y;
                
                vec2 mouse = u_mouse / u_resolution.xy;
                mouse.x *= u_resolution.x / u_resolution.y;

                float t = u_time * 0.5;
                
                // Orb centers
                vec2 c1 = vec2(0.5, 0.5) + vec2(cos(t * 0.5), sin(t * 0.3)) * 0.2;
                vec2 c2 = mouse; // Mouse follows

                // Distances
                float d1 = length(st - c1);
                float d2 = length(st - c2);

                // Fluid mix
                float f = 0.0;
                f += 0.5 / d1;
                f += 0.3 / (d2 + 0.1); // Add mouse influence
                
                // Color Morph - Dark SaaS Theme (Purple/Blue/Cyan)
                vec3 color = vec3(0.0);
                
                // Brighter/Larger Orb
                // f is inverse distance. larger f = closer to center.
                // 0.5/d1. if d1=0.5, f=1.0. if d1=0.25, f=2.0.
                
                color += vec3(0.4, 0.2, 0.9) * smoothstep(1.0, 3.0, f); // Deep Purple Base
                color += vec3(0.2, 0.6, 1.0) * smoothstep(2.5, 6.0, f) * 0.8; // Blue Glow Core
                
                // Add subtle background noise/stars
                float n = noise(st * 10.0 + t * 0.1);
                color += vec3(0.5, 0.5, 0.8) * n * 0.05;

                // Ensure background isn't pure black transparency if we want it to be the "Nebula"
                // But we want it to blend with CSS background?
                // Provide a base alpha that is non-zero
                
                gl_FragColor = vec4(color, color.r * 0.5 + 0.5); // Add alpha based on brightness
            }
        `;

        // Compile Shaders
        const createShader = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error(gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vs = createShader(gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.useProgram(program);

        // Buffer
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        const positionLoc = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(positionLoc);
        gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

        // Uniforms
        const timeLoc = gl.getUniformLocation(program, 'u_time');
        const resLoc = gl.getUniformLocation(program, 'u_resolution');
        const mouseLoc = gl.getUniformLocation(program, 'u_mouse');

        let mouseX = 0, mouseY = 0;
        window.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY; // Fix Y coordinate for WebGL
            mouseY = window.innerHeight - e.clientY;
        });

        // Loop
        const render = (time) => {
            time *= 0.001; // Seconds
            gl.uniform1f(timeLoc, time);
            gl.uniform2f(resLoc, canvas.width, canvas.height);
            gl.uniform2f(mouseLoc, mouseX, mouseY);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    initParticleCursor() {
        const input = document.getElementById('projectDesc');
        if (!input) return;

        // Create overlay canvas for particles
        const canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '9999';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        document.body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const particles = [];

        // Colors: Purple, Blue, Cyan, White
        const colors = ['#7b68ee', '#3b82f6', '#06b6d4', '#ffffff'];

        // Particle Class
        class Particle {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.size = Math.random() * 3 + 1;
                this.speedX = Math.random() * 4 - 2;
                this.speedY = Math.random() * 4 - 2;
                this.color = colors[Math.floor(Math.random() * colors.length)];
                this.life = 1.0;
            }
            update() {
                this.x += this.speedX;
                this.y += this.speedY;
                this.life -= 0.03;
                this.size *= 0.95;
            }
            draw() {
                ctx.fillStyle = this.color;
                ctx.globalAlpha = this.life;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Helper to get caret coordinates (Robust Mirror Div)
        const getCaretCoordinates = (element, position) => {
            const div = document.createElement('div');
            const style = getComputedStyle(element);

            // Copy styles
            const properties = [
                'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
                'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
                'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
                'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize'
            ];

            properties.forEach(prop => {
                div.style[prop] = style[prop];
            });

            div.style.position = 'absolute';
            div.style.top = '0px';
            div.style.left = '0px';
            div.style.visibility = 'hidden';
            div.style.whiteSpace = 'pre-wrap';
            div.style.wordWrap = 'break-word'; // Important for textarea

            // Content
            div.textContent = element.value.substring(0, position);

            const span = document.createElement('span');
            span.textContent = element.value.substring(position) || '.';
            div.appendChild(span);

            document.body.appendChild(div);

            const rect = element.getBoundingClientRect();
            const coordinates = {
                top: div.scrollTop + span.offsetTop, // Span offset relative to div
                left: span.offsetLeft,
                height: parseInt(style.lineHeight) // approximate
            };

            document.body.removeChild(div);

            // Calculate absolute position on screen
            return {
                x: rect.left + coordinates.left + parseInt(style.borderLeftWidth) + parseInt(style.paddingLeft),
                y: rect.top + coordinates.top + parseInt(style.borderTopWidth) + parseInt(style.paddingTop) - element.scrollTop
            };
        };

        // Listeners
        const addParticles = () => {
            const pos = input.selectionStart;
            const coords = getCaretCoordinates(input, pos);

            // Emit particles from caret
            for (let i = 0; i < 5; i++) {
                particles.push(new Particle(coords.x, coords.y + 10)); // +10 for visual offset
            }
        };

        input.addEventListener('input', addParticles);
        input.addEventListener('keydown', (e) => {
            // Also spark on arrow keys etc
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backspace'].includes(e.key)) {
                setTimeout(addParticles, 0);
            }
        });

        // Resize
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        });

        // Loop
        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < particles.length; i++) {
                particles[i].update();
                particles[i].draw();
                if (particles[i].life <= 0) {
                    particles.splice(i, 1);
                    i--;
                }
            }
            requestAnimationFrame(animate);
        };
        animate();
    }
}

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => {
    window.animations = new AnimationManager();
});
