/**
 * FB-SYSTEM - Animations & Interactions
 * Professional scroll animations, counters, parallax, typewriter effects
 */

(function() {
    'use strict';

    // ========================================
    // 1. SCROLL ANIMATIONS (Intersection Observer)
    // ========================================
    class ScrollAnimator {
        constructor() {
            this.observer = null;
            this.init();
        }

        init() {
            const options = {
                threshold: 0.1,
                rootMargin: '0px 0px -50px 0px'
            };

            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const el = entry.target;
                        const delay = el.dataset.delay || 0;
                        const duration = el.dataset.duration || '0.6s';

                        setTimeout(() => {
                            el.style.transitionDuration = duration;
                            el.classList.add('visible');
                            
                            // Trigger counter if present
                            if (el.classList.contains('stat-counter')) {
                                this.animateCounter(el);
                            }
                        }, delay);
                        
                        this.observer.unobserve(el);
                    }
                });
            }, options);

            // Observe all elements with animate-on-scroll class
            document.querySelectorAll('.animate-on-scroll').forEach(el => {
                this.observer.observe(el);
            });

            // Observe staggered children
            document.querySelectorAll('.stagger-children').forEach(parent => {
                parent.querySelectorAll('.stagger-item').forEach((child, index) => {
                    child.dataset.delay = child.dataset.delay || (index * 100);
                    this.observer.observe(child);
                });
            });
        }

        animateCounter(el) {
            const target = parseInt(el.dataset.target) || 0;
            const suffix = el.dataset.suffix || '';
            const prefix = el.dataset.prefix || '';
            const duration = parseInt(el.dataset.duration) || 2000;
            const start = parseInt(el.dataset.start) || 0;
            
            if (target === 0) return;
            
            let current = start;
            const increment = (target - start) / (duration / 16);
            const formatNumber = (num) => {
                if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
                return Math.floor(num).toString();
            };

            const update = () => {
                current += increment;
                if (current >= target) {
                    el.textContent = prefix + formatNumber(target) + suffix;
                    el.classList.add('counter-done');
                    return;
                }
                el.textContent = prefix + formatNumber(current) + suffix;
                requestAnimationFrame(update);
            };
            
            update();
        }
    }

    // ========================================
    // 2. TYPEWRITER EFFECT
    // ========================================
    class TypeWriter {
        constructor() {
            document.querySelectorAll('.typewriter').forEach(el => this.initTypewriter(el));
        }

        initTypewriter(element) {
            const texts = JSON.parse(element.dataset.texts || '[]');
            const typeSpeed = parseInt(element.dataset.typeSpeed) || 80;
            const deleteSpeed = parseInt(element.dataset.deleteSpeed) || 40;
            const pauseTime = parseInt(element.dataset.pause) || 2000;
            
            if (texts.length === 0) return;

            let textIndex = 0;
            let charIndex = 0;
            let isDeleting = false;
            const cursor = element.querySelector('.cursor') || (() => {
                const c = document.createElement('span');
                c.className = 'cursor';
                c.textContent = '|';
                c.style.cssText = 'animation: blink 0.7s infinite; color: var(--primary); font-weight: 100;';
                element.appendChild(c);
                return c;
            })();

            const type = () => {
                const currentText = texts[textIndex];
                
                if (isDeleting) {
                    element.textContent = currentText.substring(0, charIndex - 1);
                    charIndex--;
                    element.appendChild(cursor);
                } else {
                    element.textContent = currentText.substring(0, charIndex + 1);
                    charIndex++;
                    element.appendChild(cursor);
                }

                if (!isDeleting && charIndex === currentText.length) {
                    isDeleting = true;
                    setTimeout(type, pauseTime);
                    return;
                }

                if (isDeleting && charIndex === 0) {
                    isDeleting = false;
                    textIndex = (textIndex + 1) % texts.length;
                    setTimeout(type, 500);
                    return;
                }

                setTimeout(type, isDeleting ? deleteSpeed : typeSpeed);
            };

            setTimeout(type, 1000);
        }
    }

    // ========================================
    // 3. PARALLAX EFFECT
    // ========================================
    class ParallaxEffect {
        constructor() {
            this.init();
        }

        init() {
            document.querySelectorAll('.parallax').forEach(el => {
                const speed = parseFloat(el.dataset.speed) || 0.3;
                
                const handleScroll = () => {
                    const rect = el.getBoundingClientRect();
                    const windowHeight = window.innerHeight;
                    
                    if (rect.top < windowHeight && rect.bottom > 0) {
                        const offset = (windowHeight - rect.top) * speed;
                        el.style.transform = `translateY(${offset * 0.5}px)`;
                    }
                };

                window.addEventListener('scroll', handleScroll, { passive: true });
                handleScroll();
            });
        }
    }

    // ========================================
    // 4. SMOOTH REVEAL
    // ========================================
    class RevealEffect {
        constructor() {
            document.querySelectorAll('.reveal').forEach(el => {
                const direction = el.dataset.direction || 'up';
                const distance = el.dataset.distance || '60px';
                
                const transforms = {
                    up: `translateY(${distance})`,
                    down: `translateY(-${distance})`,
                    left: `translateX(${distance})`,
                    right: `translateX(-${distance})`
                };

                el.style.transform = transforms[direction] || transforms.up;
                el.style.opacity = '0';
                el.style.transition = `all 0.8s cubic-bezier(0.4, 0, 0.2, 1)`;
                
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const delay = parseInt(el.dataset.delay) || 0;
                            setTimeout(() => {
                                el.style.transform = 'translate(0, 0)';
                                el.style.opacity = '1';
                            }, delay);
                            observer.unobserve(el);
                        }
                    });
                }, { threshold: 0.1 });

                observer.observe(el);
            });
        }
    }

    // ========================================
    // 5. TILT CARD EFFECT (3D Hover)
    // ========================================
    class TiltEffect {
        constructor() {
            document.querySelectorAll('.tilt-card').forEach(card => {
                card.addEventListener('mousemove', (e) => {
                    const rect = card.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    const rotateX = (y - centerY) / centerY * -8;
                    const rotateY = (x - centerX) / centerX * 8;
                    
                    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
                });

                card.addEventListener('mouseleave', () => {
                    card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)';
                });
            });
        }
    }

    // ========================================
    // 6. RIPPLE BUTTON EFFECT
    // ========================================
    class RippleEffect {
        constructor() {
            document.querySelectorAll('.btn-ripple').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const ripple = document.createElement('span');
                    const rect = btn.getBoundingClientRect();
                    
                    ripple.style.cssText = `
                        position: absolute;
                        border-radius: 50%;
                        background: rgba(255, 255, 255, 0.4);
                        width: 60px;
                        height: 60px;
                        left: ${e.clientX - rect.left - 30}px;
                        top: ${e.clientY - rect.top - 30}px;
                        transform: scale(0);
                        animation: rippleAnim 0.6s ease-out;
                        pointer-events: none;
                    `;
                    
                    btn.style.position = 'relative';
                    btn.style.overflow = 'hidden';
                    btn.appendChild(ripple);
                    
                    setTimeout(() => ripple.remove(), 600);
                });
            });
        }
    }

    // ========================================
    // 7. GLOW CURSOR
    // ========================================
    class GlowCursor {
        constructor() {
            const cursor = document.querySelector('.glow-cursor');
            if (!cursor) return;

            const moveCursor = (e) => {
                cursor.style.transform = `translate(${e.clientX - 150}px, ${e.clientY - 150}px)`;
            };

            document.addEventListener('mousemove', moveCursor, { passive: true });
        }
    }

    // ========================================
    // 8. SMOOTH SCROLL FOR ANCHOR LINKS
    // ========================================
    class SmoothScroll {
        constructor() {
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', (e) => {
                    const target = document.querySelector(anchor.getAttribute('href'));
                    if (target) {
                        e.preventDefault();
                        const headerOffset = 80;
                        const elementPosition = target.getBoundingClientRect().top;
                        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                        
                        window.scrollTo({
                            top: offsetPosition,
                            behavior: 'smooth'
                        });
                    }
                });
            });
        }
    }

    // ========================================
    // 9. PROGRESS BAR (Scroll Progress)
    // ========================================
    class ScrollProgress {
        constructor() {
            const bar = document.querySelector('.scroll-progress');
            if (!bar) return;

            const update = () => {
                const scrollTop = window.scrollY;
                const docHeight = document.documentElement.scrollHeight - window.innerHeight;
                const progress = (scrollTop / docHeight) * 100;
                bar.style.width = `${Math.min(progress, 100)}%`;
            };

            window.addEventListener('scroll', update, { passive: true });
            update();
        }
    }

    // ========================================
    // 10. AUTO COUNTDOWN TIMER
    // ========================================
    class CountdownTimer {
        constructor() {
            document.querySelectorAll('.countdown').forEach(el => {
                const targetDate = new Date(el.dataset.target).getTime();
                
                const update = () => {
                    const now = new Date().getTime();
                    const distance = targetDate - now;
                    
                    if (distance < 0) {
                        el.innerHTML = '🎉 Đã diễn ra!';
                        return;
                    }

                    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
                    
                    el.querySelector('.days').textContent = String(days).padStart(2, '0');
                    el.querySelector('.hours').textContent = String(hours).padStart(2, '0');
                    el.querySelector('.minutes').textContent = String(minutes).padStart(2, '0');
                    el.querySelector('.seconds').textContent = String(seconds).padStart(2, '0');
                };

                update();
                setInterval(update, 1000);
            });
        }
    }

    // ========================================
    // 11. PARTICLE BACKGROUND
    // ========================================
    class ParticleBg {
        constructor() {
            document.querySelectorAll('.particle-bg').forEach(canvas => {
                const ctx = canvas.getContext('2d');
                let particles = [];
                const particleCount = parseInt(canvas.dataset.count) || 50;
                const colors = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b'];

                const resize = () => {
                    canvas.width = canvas.offsetWidth;
                    canvas.height = canvas.offsetHeight;
                };

                class Particle {
                    constructor() {
                        this.reset();
                    }

                    reset() {
                        this.x = Math.random() * canvas.width;
                        this.y = Math.random() * canvas.height;
                        this.size = Math.random() * 3 + 1;
                        this.speedX = (Math.random() - 0.5) * 0.5;
                        this.speedY = (Math.random() - 0.5) * 0.5;
                        this.opacity = Math.random() * 0.5 + 0.1;
                        this.color = colors[Math.floor(Math.random() * colors.length)];
                    }

                    update() {
                        this.x += this.speedX;
                        this.y += this.speedY;

                        if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
                        if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
                    }

                    draw() {
                        ctx.beginPath();
                        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                        ctx.fillStyle = this.color;
                        ctx.globalAlpha = this.opacity;
                        ctx.fill();
                    }
                }

                const init = () => {
                    resize();
                    particles = [];
                    for (let i = 0; i < particleCount; i++) {
                        particles.push(new Particle());
                    }
                };

                const animate = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    particles.forEach(p => {
                        p.update();
                        p.draw();
                    });

                    // Draw connections
                    particles.forEach((a, i) => {
                        for (let j = i + 1; j < particles.length; j++) {
                            const b = particles[j];
                            const dx = a.x - b.x;
                            const dy = a.y - b.y;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            
                            if (distance < 150) {
                                ctx.beginPath();
                                ctx.moveTo(a.x, a.y);
                                ctx.lineTo(b.x, b.y);
                                ctx.strokeStyle = a.color;
                                ctx.globalAlpha = (1 - distance / 150) * 0.15;
                                ctx.lineWidth = 0.5;
                                ctx.stroke();
                            }
                        }
                    });

                    requestAnimationFrame(animate);
                };

                init();
                animate();
                window.addEventListener('resize', init);
            });
        }
    }

    // ========================================
    // 12. SHIMMER LOADING SKELETON
    // ========================================
    class SkeletonLoader {
        constructor() {
            document.querySelectorAll('.skeleton-loader').forEach(container => {
                const items = parseInt(container.dataset.items) || 3;
                const type = container.dataset.type || 'card';
                
                const templates = {
                    card: `
                        <div class="skeleton-card">
                            <div class="skeleton-image shimmer"></div>
                            <div class="skeleton-content">
                                <div class="skeleton-title shimmer"></div>
                                <div class="skeleton-text shimmer"></div>
                                <div class="skeleton-text short shimmer"></div>
                            </div>
                        </div>
                    `,
                    list: `
                        <div class="skeleton-list-item">
                            <div class="skeleton-avatar shimmer"></div>
                            <div class="skeleton-content">
                                <div class="skeleton-title shimmer"></div>
                                <div class="skeleton-text shimmer"></div>
                            </div>
                        </div>
                    `,
                    table: `
                        <div class="skeleton-table-row">
                            ${Array(4).fill('<div class="skeleton-cell shimmer"></div>').join('')}
                        </div>
                    `
                };

                const template = templates[type] || templates.card;
                container.innerHTML = Array(items).fill(template).join('');
            });
        }
    }

    // ========================================
    // INIT ALL ANIMATIONS
    // ========================================
    document.addEventListener('DOMContentLoaded', () => {
        // Initialize all animation classes
        new ScrollAnimator();
        new TypeWriter();
        new ParallaxEffect();
        new RevealEffect();
        new TiltEffect();
        new RippleEffect();
        new GlowCursor();
        new SmoothScroll();
        new ScrollProgress();
        new CountdownTimer();
        new ParticleBg();
        new SkeletonLoader();

        // Animate stats on page load
        document.querySelectorAll('.stat-counter.visible').forEach(el => {
            if (el.classList.contains('counter-done')) return;
            // Trigger counter immediately if already visible
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                const animator = new ScrollAnimator();
                animator.animateCounter(el);
            }
        });

        // Lazy load images with blur effect
        document.querySelectorAll('img[data-src]').forEach(img => {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        img.src = img.dataset.src;
                        img.classList.add('loaded');
                        observer.unobserve(img);
                    }
                });
            });
            observer.observe(img);
        });

        console.log('🎯 FB-SYSTEM Animations initialized');
    });

})();