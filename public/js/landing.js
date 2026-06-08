/* ===================================
   landing.js - ReelsFlow AI Premium v3
   Particles, Chat Bot, All Animations
   =================================== */

(function () {
    'use strict';

    // ===== PARTICLES CANVAS =====
    function initParticles() {
        const canvas = document.getElementById('particlesCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        let particles = [];
        const maxParticles = 50;
        let w, h;

        function resize() {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        class Particle {
            constructor() {
                this.reset();
            }
            reset() {
                this.x = Math.random() * w;
                this.y = Math.random() * h;
                this.size = Math.random() * 2 + 0.5;
                this.speedX = (Math.random() - 0.5) * 0.4;
                this.speedY = (Math.random() - 0.5) * 0.4;
                this.opacity = Math.random() * 0.3 + 0.05;
            }
            update() {
                this.x += this.speedX;
                this.y += this.speedY;
                if (this.x < -20) this.x = w + 20;
                if (this.x > w + 20) this.x = -20;
                if (this.y < -20) this.y = h + 20;
                if (this.y > h + 20) this.y = -20;
            }
            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(59, 92, 246, ${this.opacity})`;
                ctx.fill();
            }
        }

        for (let i = 0; i < maxParticles; i++) {
            particles.push(new Particle());
        }

        // Draw connections
        function drawConnections() {
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(59, 92, 246, ${0.04 * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
        }

        function animate() {
            ctx.clearRect(0, 0, w, h);
            particles.forEach(p => {
                p.update();
                p.draw();
            });
            drawConnections();
            requestAnimationFrame(animate);
        }

        animate();
    }

    // ===== CURSOR GLOW =====
    function initCursorGlow() {
        const glow = document.getElementById('cursorGlow');
        if (!glow) return;

        let mouseX = -500, mouseY = -500;
        let currentX = -500, currentY = -500;

        document.addEventListener('mousemove', function (e) {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });

        document.addEventListener('mouseleave', function () {
            mouseX = -500;
            mouseY = -500;
        });

        function animateGlow() {
            currentX += (mouseX - currentX) * 0.07;
            currentY += (mouseY - currentY) * 0.07;
            glow.style.left = currentX + 'px';
            glow.style.top = currentY + 'px';
            requestAnimationFrame(animateGlow);
        }

        requestAnimationFrame(animateGlow);
    }

    // ===== SCROLL REVEAL =====
    function initScrollReveal() {
        const reveals = document.querySelectorAll('.reveal');
        if (!reveals.length) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.08, rootMargin: '0px 0px -50px 0px' }
        );

        reveals.forEach((el) => observer.observe(el));
    }

    // ===== NAV SCROLL =====
    function initNavScroll() {
        const nav = document.getElementById('landingNav');
        if (!nav) return;
        function onScroll() {
            nav.classList.toggle('scrolled', window.scrollY > 60);
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    // ===== MOBILE NAV =====
    function initMobileNav() {
        const toggleBtn = document.getElementById('landingNavToggle');
        const navLinks = document.getElementById('landingNavLinks');
        if (!toggleBtn || !navLinks) return;

        toggleBtn.addEventListener('click', function () {
            const isOpen = navLinks.classList.toggle('open');
            const icon = toggleBtn.querySelector('i');
            if (icon) icon.className = isOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
            document.body.style.overflow = isOpen ? 'hidden' : '';
        });

        navLinks.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('open');
                const icon = toggleBtn.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-bars';
                document.body.style.overflow = '';
            });
        });

        document.addEventListener('click', function (e) {
            if (!toggleBtn.contains(e.target) && !navLinks.contains(e.target)) {
                if (navLinks.classList.contains('open')) {
                    navLinks.classList.remove('open');
                    const icon = toggleBtn.querySelector('i');
                    if (icon) icon.className = 'fa-solid fa-bars';
                    document.body.style.overflow = '';
                }
            }
        });
    }

    // ===== TYPING EFFECT =====
    var _typingTimer = null;
    var _typingStopped = false;

    function restartTyping() {
        _typingStopped = false;
        var typingEl = document.getElementById('typingText');
        if (!typingEl) return;
        var phrases = window._typingPhrases || [
            'Facebook Reels', 'Instagram Stories', 'TikTok Videos',
            'YouTube Shorts', 'Group Posts'
        ];
        var phraseIndex = 0;
        var charIndex = 0;
        var isDeleting = false;

        function type() {
            if (_typingStopped) return;
            var fullPhrase = phrases[phraseIndex];
            typingEl.textContent = isDeleting
                ? fullPhrase.substring(0, charIndex - 1)
                : fullPhrase.substring(0, charIndex + 1);

            if (isDeleting) charIndex--;
            else charIndex++;

            var speed = isDeleting ? 40 : 80;

            if (!isDeleting && charIndex === fullPhrase.length) {
                speed = 2000;
                isDeleting = true;
            } else if (isDeleting && charIndex === 0) {
                isDeleting = false;
                phraseIndex = (phraseIndex + 1) % phrases.length;
                speed = 400;
            }

            _typingTimer = setTimeout(type, speed);
        }

        _typingTimer = setTimeout(type, 800);
    }

    function initTypingEffect() {
        restartTyping();
    }

    // ===== COUNTER ANIMATION =====
    function initCounters() {
        const statNumbers = document.querySelectorAll('.stat-number');
        if (!statNumbers.length) return;

        function formatNum(value, isFloat) {
            var str = isFloat ? value.toFixed(1) : String(Math.round(value));
            var parts = str.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            return parts.join('.');
        }

        var observer = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        var el = entry.target;
                        var raw = el.getAttribute('data-target');
                        var target = parseFloat(raw);
                        if (isNaN(target)) { observer.unobserve(el); return; }
                        var suffix = el.getAttribute('data-suffix') || '';
                        var prefix = el.getAttribute('data-prefix') || '';
                        var duration = 2200;
                        var startTime = performance.now();
                        var isFloat = target % 1 !== 0;

                        function animate(now) {
                            var elapsed = now - startTime;
                            var progress = Math.min(elapsed / duration, 1);
                            var eased = 1 - Math.pow(1 - progress, 3.5);
                            var current = target * eased;
                            el.textContent = prefix + formatNum(current, isFloat) + suffix;

                            if (progress < 1) {
                                requestAnimationFrame(animate);
                            } else {
                                el.textContent = prefix + formatNum(target, isFloat) + suffix;
                            }
                        }

                        requestAnimationFrame(animate);
                        observer.unobserve(el);
                    }
                });
            },
            { threshold: 0.4 }
        );

        statNumbers.forEach(function (el) { observer.observe(el); });
    }

    // ===== PRICING TOGGLE =====
    function initPricingToggle() {
        const monthlyLabel = document.getElementById('monthlyLabel');
        const yearlyLabel = document.getElementById('yearlyLabel');
        if (!monthlyLabel || !yearlyLabel) return;

        const monthlyPrices = document.querySelectorAll('.price-monthly');
        const yearlyPrices = document.querySelectorAll('.price-yearly');
        const saveBadges = document.querySelectorAll('.pricing-save-badge');
        let isYearly = false;

        function updatePricing() {
            monthlyLabel.classList.toggle('active', !isYearly);
            yearlyLabel.classList.toggle('active', isYearly);
            monthlyPrices.forEach((el) => (el.style.display = isYearly ? 'none' : 'inline'));
            yearlyPrices.forEach((el) => (el.style.display = isYearly ? 'inline' : 'none'));
            saveBadges.forEach((el) => (el.style.display = isYearly ? 'inline' : 'none'));
        }

        monthlyLabel.addEventListener('click', () => { if (isYearly) { isYearly = false; updatePricing(); } });
        yearlyLabel.addEventListener('click', () => { if (!isYearly) { isYearly = true; updatePricing(); } });
        updatePricing();
    }

    // ===== FAQ ACCORDION =====
    function initFAQ() {
        const faqItems = document.querySelectorAll('.faq-item');
        if (!faqItems.length) return;

        faqItems.forEach((item) => {
            const question = item.querySelector('.faq-question');
            if (!question) return;
            question.addEventListener('click', function () {
                faqItems.forEach((otherItem) => {
                    if (otherItem !== item && otherItem.classList.contains('open')) {
                        otherItem.classList.remove('open');
                    }
                });
                item.classList.toggle('open');
            });
        });
    }

    // ===== SMOOTH SCROLL =====
    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const targetId = this.getAttribute('href').substring(1);
                const target = document.getElementById(targetId);
                if (target) {
                    const navHeight = document.getElementById('landingNav')?.offsetHeight || 72;
                    const top = target.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
                    window.scrollTo({ top, behavior: 'smooth' });
                }
            });
        });
    }

    // ===== ACTIVE NAV LINK =====
    function initActiveNavLink() {
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.landing-nav-link');
        if (!sections.length || !navLinks.length) return;

        function onScroll() {
            let current = '';
            sections.forEach((section) => {
                const sectionTop = section.offsetTop - 140;
                if (window.scrollY >= sectionTop) {
                    current = section.getAttribute('id');
                }
            });
            navLinks.forEach((link) => {
                link.classList.toggle('active', link.getAttribute('href') === '#' + current);
            });
        }

        window.addEventListener('scroll', onScroll, { passive: true });
    }

    // ===== HERO PARALLAX =====
    function initHeroParallax() {
        const orbs = document.querySelectorAll('.hero-orb');
        if (!orbs.length) return;

        document.addEventListener('mousemove', function (e) {
            const x = (e.clientX / window.innerWidth - 0.5) * 20;
            const y = (e.clientY / window.innerHeight - 0.5) * 20;
            orbs.forEach((orb, index) => {
                const factor = (index + 1) * 0.5;
                orb.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
            });
        });
    }

    // ===== CHAT BOT =====
    function initChatBot() {
        const toggleBtn = document.getElementById('chatToggle');
        const chatWindow = document.getElementById('chatWindow');
        const closeBtn = document.getElementById('chatClose');
        const messagesContainer = document.getElementById('chatMessages');
        const chatInput = document.getElementById('chatInput');
        const sendBtn = document.getElementById('chatSend');
        const typingIndicator = document.getElementById('chatTyping');
        const quickReplies = document.querySelectorAll('.chat-quick-btn');

        if (!toggleBtn || !chatWindow) return;

        function addMessage(text, type) {
            const msgDiv = document.createElement('div');
            msgDiv.className = 'chat-msg ' + type;

            const avatar = document.createElement('div');
            avatar.className = 'chat-msg-avatar';
            avatar.innerHTML = type === 'bot' ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>';

            const bubble = document.createElement('div');
            bubble.className = 'chat-msg-bubble';
            bubble.textContent = text;

            msgDiv.appendChild(avatar);
            msgDiv.appendChild(bubble);
            messagesContainer.appendChild(msgDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function showTyping() {
            if (typingIndicator) typingIndicator.classList.add('show');
        }

        function hideTyping() {
            if (typingIndicator) typingIndicator.classList.remove('show');
        }

        function handleSend() {
            const text = chatInput ? chatInput.value.trim() : '';
            if (!text) return;

            addMessage(text, 'user');
            chatInput.value = '';
            showTyping();

            setTimeout(() => {
                hideTyping();
                addMessage(getBotReply(text), 'bot');
            }, 1000 + Math.random() * 1500);
        }

        // Toggle chat window
        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            chatWindow.classList.toggle('open');
        });

        // Close chat
        if (closeBtn) {
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                chatWindow.classList.remove('open');
            });
        }

        // Close on outside click
        document.addEventListener('click', function (e) {
            if (!chatWindow.contains(e.target) && !toggleBtn.contains(e.target)) {
                chatWindow.classList.remove('open');
            }
        });

        // Send message
        if (sendBtn) sendBtn.addEventListener('click', handleSend);
        if (chatInput) {
            chatInput.addEventListener('keypress', function (e) {
                if (e.key === 'Enter') handleSend();
            });
        }

        // Quick replies
        quickReplies.forEach((btn) => {
            btn.addEventListener('click', function () {
                const text = this.textContent;
                addMessage(text, 'user');
                showTyping();
                setTimeout(() => {
                    hideTyping();
                    addMessage(getBotReply(text), 'bot');
                }, 1000 + Math.random() * 1500);
            });
        });
    }

    // ===== I18N / LANGUAGE SWITCHING =====
    var translations = {
        // Navigation
        nav_how: { vi: 'Cách hoạt động', en: 'How It Works' },
        nav_features: { vi: 'Tính năng', en: 'Features' },
        nav_stats: { vi: 'Thống kê', en: 'Statistics' },
        nav_pricing: { vi: 'Bảng giá', en: 'Pricing' },
        nav_faq: { vi: 'FAQ', en: 'FAQ' },
        nav_login: { vi: 'Đăng nhập', en: 'Log In' },
        // Hero
        hero_badge: { vi: 'Nền tảng hoạt động ổn định', en: 'Platform running smoothly' },
        hero_title_1: { vi: 'Tự Động Hóa Content', en: 'Automate Your Content' },
        hero_title_2: { vi: 'Đa Kênh Với AI', en: 'Across All Channels With AI' },
        hero_subtitle_prefix: { vi: 'Lên lịch, đăng bài, quản lý nội dung tự động trên ', en: 'Schedule, post, and manage content automatically on ' },
        hero_subtitle_suffix: { vi: ' — tất cả trong một nền tảng duy nhất.', en: ' — all in one platform.' },
        hero_cta_primary: { vi: 'Dùng thử miễn phí', en: 'Start Free Trial' },
        hero_cta_secondary: { vi: 'Xem cách hoạt động', en: 'See How It Works' },
        trust_1: { vi: 'Miễn phí 7 ngày', en: '7-day free trial' },
        trust_2: { vi: 'Không cần thẻ tín dụng', en: 'No credit card required' },
        trust_3: { vi: 'Hủy bất cứ lúc nào', en: 'Cancel anytime' },
        trust_4: { vi: 'Hỗ trợ 24/7', en: '24/7 support' },
        // How It Works
        how_label: { vi: 'Cách hoạt động', en: 'HOW IT WORKS' },
        how_title: { vi: 'Bắt đầu chỉ trong 3 bước đơn giản', en: 'Get Started in 3 Simple Steps' },
        how_subtitle: { vi: 'Không cần cài đặt phức tạp. Kết nối tài khoản, cấu hình và bắt đầu tự động hóa ngay.', en: 'No complex setup. Connect your account, configure, and start automating right away.' },
        step1_title: { vi: 'Kết nối tài khoản mạng xã hội', en: 'Connect Social Media Accounts' },
        step1_desc: { vi: 'Liên kết tài khoản Facebook, Instagram, TikTok hoặc YouTube chỉ với vài cú click. Hệ thống mã hóa session và mô phỏng hành vi người dùng thật để đảm bảo an toàn tuyệt đối.', en: 'Link your Facebook, Instagram, TikTok, or YouTube accounts with just a few clicks. Our system encrypts sessions and mimics real user behavior for maximum safety.' },
        step1_highlight: { vi: 'Mã hóa & bảo mật cao cấp', en: 'Advanced encryption & security' },
        step2_title: { vi: 'Tạo & lên lịch nội dung', en: 'Create & Schedule Content' },
        step2_desc: { vi: 'Upload video, viết caption, chọn kênh đích và đặt lịch đăng. Hỗ trợ lên lịch hàng loạt, đăng theo khung giờ vàng, AI gợi ý caption thông minh.', en: 'Upload videos, write captions, select target channels, and set posting schedules. Supports bulk scheduling, peak-hour posting, and AI-powered caption suggestions.' },
        step2_highlight: { vi: 'AI gợi ý caption tự động', en: 'AI auto-suggests captions' },
        step3_title: { vi: 'Theo dõi & tối ưu hiệu suất', en: 'Track & Optimize Performance' },
        step3_desc: { vi: 'Dashboard trực quan hiển thị mọi chỉ số quan trọng. AI Scan tự động trả lời comment và inbox, không bỏ lỡ bất kỳ lead nào.', en: 'Visual dashboards showing all key metrics. AI Scan auto-replies to comments and DMs, so you never miss a lead.' },
        step3_highlight: { vi: 'Báo cáo thời gian thực', en: 'Real-time reporting' },
        // Features
        feat_label: { vi: 'Tính năng nổi bật', en: 'KEY FEATURES' },
        feat_title: { vi: 'Mọi thứ bạn cần để<br>quản lý content chuyên nghiệp', en: 'Everything You Need for<br>Professional Content Management' },
        feat_subtitle: { vi: 'Từ lên lịch đăng bài, AI tự động trả lời comment, đến quản lý video đa nền tảng — tất cả trong một dashboard.', en: 'From scheduling posts, AI auto-replying to comments, to managing multi-platform videos — all in one dashboard.' },
        feat1_title: { vi: 'Lên Lịch Đăng Bài', en: 'Smart Scheduling' },
        feat1_desc: { vi: 'Lập lịch đăng Reels, Post, Story hàng loạt. Hỗ trợ khung giờ vàng, tự động lặp chu kỳ.', en: 'Schedule Reels, Posts, Stories in bulk. Supports golden hours and automatic recurring cycles.' },
        feat2_title: { vi: 'AI Scan & Auto Reply', en: 'AI Scan & Auto Reply' },
        feat2_desc: { vi: 'AI quét comment, inbox theo cấu hình thông minh. Tự động trả lời khách hàng 24/7.', en: 'AI scans comments and DMs with smart configurations. Auto-reply to customers 24/7.' },
        feat3_title: { vi: 'Quản Lý Đa Kênh', en: 'Multi-Channel Management' },
        feat3_desc: { vi: 'Kết nối và quản lý Facebook, Instagram, TikTok, YouTube, Shopee trong một giao diện tập trung.', en: 'Connect and manage Facebook, Instagram, TikTok, YouTube, Shopee in one centralized interface.' },
        feat4_title: { vi: 'Lưu Trữ Đám Mây', en: 'Cloud Storage' },
        feat4_desc: { vi: 'Tích hợp Google Drive, tự động backup video và dữ liệu. Quản lý file media dễ dàng.', en: 'Google Drive integration, automatic video and data backup. Easy media file management.' },
        feat5_title: { vi: 'Thống Kê & Báo Cáo', en: 'Analytics & Reports' },
        feat5_desc: { vi: 'Dashboard trực quan hiển thị hiệu suất từng kênh. Lượt xem, tương tác, tỉ lệ chuyển đổi.', en: 'Visual dashboards showing each channel\'s performance. Views, engagement, conversion rates.' },
        feat6_title: { vi: 'Bảo Mật & Ổn Định', en: 'Security & Stability' },
        feat6_desc: { vi: 'Mã hóa session, mô phỏng hành vi người dùng thật. Giữ an toàn tuyệt đối cho tài khoản.', en: 'Session encryption, real human-like behavior simulation. Keeps your accounts completely safe.' },
        // Stats
        stats_label: { vi: 'Con số ấn tượng', en: 'BY THE NUMBERS' },
        stats_title: { vi: 'Được tin dùng bởi<br>hàng ngàn creator', en: 'Trusted by Thousands<br>of Creators' },
        stat1: { vi: 'Người dùng', en: 'Users' },
        stat2: { vi: 'Bài đăng đã lên lịch', en: 'Posts Scheduled' },
        stat3: { vi: 'Uptime hệ thống', en: 'System Uptime' },
        stat4: { vi: 'Thời gian tiết kiệm', en: 'Time Saved' },
        // Testimonials
        testi_label: { vi: 'Đánh giá từ người dùng', en: 'TESTIMONIALS' },
        testi_title: { vi: 'Creator nói gì<br>về ReelsFlow AI', en: 'What Creators Say<br>About ReelsFlow AI' },
        testi_subtitle: { vi: 'Hàng ngàn creator đã tin dùng và đạt được kết quả vượt mong đợi.', en: 'Thousands of creators trust us and achieve results beyond expectations.' },
        testi1_text: { vi: '"ReelsFlow AI giúp mình tiết kiệm ít nhất 3 tiếng mỗi ngày. AI auto reply cực kỳ thông minh, không bỏ lỡ lead nào."', en: '"ReelsFlow AI saves me at least 3 hours daily. The AI auto-reply is incredibly smart, never misses a lead."' },
        testi1_role: { vi: 'Content Creator', en: 'Content Creator' },
        testi2_text: { vi: '"Quản lý 5 kênh cùng lúc chưa bao giờ dễ đến thế. Lên lịch hàng loạt, đăng đúng giờ, analytics chi tiết."', en: '"Managing 5 channels at once has never been easier. Bulk scheduling, on-time posting, detailed analytics."' },
        testi2_role: { vi: 'Agency Owner', en: 'Agency Owner' },
        testi3_text: { vi: '"Tính năng AI Scan tự động trả lời comment giúp mình tăng 40% tỉ lệ chốt đơn. Rất đáng đồng tiền!"', en: '"AI Scan auto-reply increased my conversion rate by 40%. Absolutely worth it!"' },
        testi3_role: { vi: 'E-commerce Seller', en: 'E-commerce Seller' },
        // Pricing
        price_label: { vi: 'Bảng giá', en: 'PRICING' },
        price_title: { vi: 'Chọn gói phù hợp<br>với nhu cầu của bạn', en: 'Choose the Plan<br>That Fits Your Needs' },
        price_subtitle: { vi: 'Dùng thử miễn phí 7 ngày, không cần thẻ tín dụng. Hủy bất cứ lúc nào.', en: 'Free 7-day trial, no credit card required. Cancel anytime.' },
        price_monthly: { vi: 'Thanh toán tháng', en: 'Monthly' },
        price_yearly: { vi: 'Thanh toán năm', en: 'Yearly' },
        price_save: { vi: 'Tiết kiệm 20%', en: 'Save 20%' },
        plan_free_name: { vi: 'Miễn Phí', en: 'Free' },
        plan_free_desc: { vi: 'Dành cho người mới bắt đầu', en: 'For beginners getting started' },
        plan_free_f1: { vi: '1 kênh Facebook', en: '1 Facebook channel' },
        plan_free_f2: { vi: '10 bài đăng / tháng', en: '10 posts / month' },
        plan_free_f3: { vi: 'Lên lịch cơ bản', en: 'Basic scheduling' },
        plan_free_f4: { vi: 'Dashboard cơ bản', en: 'Basic dashboard' },
        plan_free_f5: { vi: 'AI Auto Reply', en: 'AI Auto Reply' },
        plan_free_f6: { vi: 'Đa nền tảng', en: 'Multi-platform' },
        plan_free_btn: { vi: 'Bắt đầu miễn phí', en: 'Get Started Free' },
        plan_pro_badge: { vi: 'Phổ biến nhất', en: 'Most Popular' },
        plan_pro_desc: { vi: 'Dành cho creator chuyên nghiệp', en: 'For professional creators' },
        plan_pro_f1: { vi: '5 kênh (FB, IG, TT, YT)', en: '5 channels (FB, IG, TT, YT)' },
        plan_pro_f2: { vi: '100 bài đăng / tháng', en: '100 posts / month' },
        plan_pro_f3: { vi: 'Lên lịch nâng cao', en: 'Advanced scheduling' },
        plan_pro_f4: { vi: 'AI Auto Reply cơ bản', en: 'Basic AI Auto Reply' },
        plan_pro_f5: { vi: 'Thống kê chi tiết', en: 'Detailed analytics' },
        plan_pro_f6: { vi: 'Hỗ trợ ưu tiên', en: 'Priority support' },
        plan_pro_btn: { vi: 'Dùng thử 7 ngày', en: 'Start 7-Day Trial' },
        plan_ent_desc: { vi: 'Dành cho agency & doanh nghiệp', en: 'For agencies & businesses' },
        plan_ent_f1: { vi: 'Không giới hạn kênh', en: 'Unlimited channels' },
        plan_ent_f2: { vi: 'Không giới hạn bài đăng', en: 'Unlimited posts' },
        plan_ent_f3: { vi: 'AI Auto Reply nâng cao', en: 'Advanced AI Auto Reply' },
        plan_ent_f4: { vi: 'AI Scan thông minh', en: 'Smart AI Scan' },
        plan_ent_f5: { vi: 'Google Drive Backup', en: 'Google Drive Backup' },
        plan_ent_f6: { vi: 'Hỗ trợ 24/7 VIP', en: '24/7 VIP Support' },
        plan_ent_f7: { vi: 'API tích hợp', en: 'API Integration' },
        plan_ent_btn: { vi: 'Liên hệ Sales', en: 'Contact Sales' },
        price_guarantee: { vi: 'Bảo đảm hoàn tiền 100% trong 30 ngày nếu không hài lòng', en: '100% money-back guarantee within 30 days if not satisfied' },
        // FAQ
        faq_title: { vi: 'Câu hỏi thường gặp', en: 'Frequently Asked Questions' },
        faq_subtitle: { vi: 'Mọi thắc mắc về ReelsFlow AI đều được giải đáp tại đây.', en: 'All your questions about ReelsFlow AI answered here.' },
        faq1_q: { vi: 'ReelsFlow AI có an toàn cho tài khoản Facebook của tôi không?', en: 'Is ReelsFlow AI safe for my Facebook account?' },
        faq1_a: { vi: 'Hoàn toàn an toàn. Chúng tôi sử dụng công nghệ mã hóa session tiên tiến và mô phỏng hành vi người dùng thật (human-like behavior) để tránh bị phát hiện.', en: 'Absolutely safe. We use advanced session encryption and real human-like behavior simulation to avoid detection.' },
        faq2_q: { vi: 'Tôi có thể kết nối bao nhiêu tài khoản?', en: 'How many accounts can I connect?' },
        faq2_a: { vi: 'Gói Miễn Phí hỗ trợ 1 kênh Facebook. Gói Pro hỗ trợ tối đa 5 kênh đa nền tảng. Gói Enterprise không giới hạn số lượng kênh.', en: 'Free plan supports 1 Facebook channel. Pro supports up to 5 cross-platform channels. Enterprise has unlimited channels.' },
        faq3_q: { vi: 'Có giới hạn số lượng bài đăng không?', en: 'Is there a post limit?' },
        faq3_a: { vi: 'Gói Miễn Phí giới hạn 10 bài/tháng. Gói Pro giới hạn 100 bài/tháng. Gói Enterprise hoàn toàn không giới hạn.', en: 'Free plan limits to 10 posts/month. Pro limits to 100 posts/month. Enterprise is completely unlimited.' },
        faq4_q: { vi: 'AI Auto Reply hoạt động như thế nào?', en: 'How does AI Auto Reply work?' },
        faq4_a: { vi: 'Bạn cấu hình từ khóa kích hoạt và mẫu câu trả lời. AI tự động quét comment và inbox, trả lời tự động với nội dung được cá nhân hóa.', en: 'You configure trigger keywords and reply templates. AI automatically scans comments and DMs, replying with personalized content.' },
        faq5_q: { vi: 'Tôi có thể hủy đăng ký bất cứ lúc nào không?', en: 'Can I cancel my subscription anytime?' },
        faq5_a: { vi: 'Có, bạn có thể hủy đăng ký bất cứ lúc nào mà không mất phí. Chính sách hoàn tiền 100% trong 30 ngày đầu tiên.', en: 'Yes, you can cancel anytime at no cost. 100% money-back guarantee within the first 30 days.' },
        // CTA
        cta_title: { vi: 'Sẵn sàng bùng nổ content của bạn?', en: 'Ready to Supercharge Your Content?' },
        cta_desc: { vi: 'Tham gia cùng 10.000+ creator đang sử dụng ReelsFlow AI mỗi ngày để tự động hóa quy trình content và tăng trưởng kênh.', en: 'Join 10,000+ creators using ReelsFlow AI every day to automate content and grow their channels.' },
        cta_btn: { vi: 'Bắt đầu miễn phí ngay', en: 'Start Free Now' },
        // Footer
        footer_desc: { vi: 'Nền tảng quản lý và tự động hóa content đa kênh dành cho creator, agency và doanh nghiệp.', en: 'Multi-channel content management and automation platform for creators, agencies, and businesses.' },
        footer_product: { vi: 'Sản phẩm', en: 'Product' },
        footer_support: { vi: 'Hỗ trợ', en: 'Support' },
        footer_help: { vi: 'Trung tâm trợ giúp', en: 'Help Center' },
        footer_guide: { vi: 'Hướng dẫn sử dụng', en: 'User Guide' },
        footer_company: { vi: 'Công ty', en: 'Company' },
        footer_about: { vi: 'Về chúng tôi', en: 'About Us' },
        footer_terms: { vi: 'Điều khoản dịch vụ', en: 'Terms of Service' },
        footer_privacy: { vi: 'Chính sách bảo mật', en: 'Privacy Policy' },
        footer_made: { vi: 'Made with ❤️ for Content Creators', en: 'Made with ❤️ for Content Creators' },
        // Chat
        chat_online: { vi: 'Online ngay', en: 'Online now' },
        chat_welcome: { vi: 'Chào bạn! 👋 Mình là trợ lý ảo của ReelsFlow AI. Bạn cần tư vấn gì về dịch vụ ạ?', en: 'Hi there! 👋 I\'m the ReelsFlow AI assistant. How can I help you today?' },
        chat_q1: { vi: 'Bảng giá', en: 'Pricing' },
        chat_q2: { vi: 'Dùng thử', en: 'Free trial' },
        chat_q3: { vi: 'An toàn', en: 'Safety' },
        chat_q4: { vi: 'Kết nối', en: 'Connections' },
        // Chat bot replies
        bot_price: { vi: 'ReelsFlow AI có 3 gói: Miễn Phí ($0), Pro ($29/tháng) và Enterprise ($79/tháng). Bạn có thể dùng thử miễn phí 7 ngày! Bạn muốn tôi tư vấn thêm về gói nào?', en: 'ReelsFlow AI has 3 plans: Free ($0), Pro ($29/mo), and Enterprise ($79/mo). You can try it free for 7 days! Which plan would you like to know more about?' },
        bot_free: { vi: 'Gói Miễn Phí cho phép bạn kết nối 1 kênh Facebook và đăng tối đa 10 bài/tháng. Hoàn toàn không cần thẻ tín dụng khi đăng ký!', en: 'The Free plan lets you connect 1 Facebook channel and post up to 10 times/month. No credit card needed to sign up!' },
        bot_pro: { vi: 'Gói Pro ($29/tháng) hỗ trợ 5 kênh đa nền tảng, 100 bài/tháng, AI Auto Reply cơ bản và thống kê chi tiết. Đây là gói được nhiều creator chọn nhất!', en: 'Pro ($29/mo) supports 5 cross-platform channels, 100 posts/month, basic AI Auto Reply, and detailed analytics. Most popular plan!' },
        bot_enterprise: { vi: 'Gói Enterprise ($79/tháng) không giới hạn kênh, không giới hạn bài đăng, AI nâng cao, Google Drive Backup và hỗ trợ 24/7 VIP.', en: 'Enterprise ($79/mo) has unlimited channels, unlimited posts, advanced AI, Google Drive Backup, and 24/7 VIP support.' },
        bot_trial: { vi: 'Bạn có thể dùng thử miễn phí 7 ngày mà không cần thẻ tín dụng. Chỉ cần đăng ký tài khoản là dùng được ngay!', en: 'You can try free for 7 days without a credit card. Just sign up and start using it right away!' },
        bot_safety: { vi: 'Hoàn toàn an toàn! Chúng tôi mã hóa session, mô phỏng hành vi người dùng thật để tránh bị phát hiện. Tất cả dữ liệu được lưu trữ bảo mật.', en: 'Completely safe! We encrypt sessions and simulate real human behavior. All data is stored securely.' },
        bot_connect: { vi: 'Bạn có thể kết nối Facebook, Instagram, TikTok và YouTube. Số lượng kênh phụ thuộc vào gói: Miễn Phí (1), Pro (5), Enterprise (không giới hạn).', en: 'You can connect Facebook, Instagram, TikTok, and YouTube. Channel count depends on the plan: Free (1), Pro (5), Enterprise (unlimited).' },
        bot_cancel: { vi: 'Bạn có thể hủy đăng ký bất cứ lúc nào, không mất phí. Chính sách hoàn tiền 100% trong 30 ngày đầu!', en: 'You can cancel anytime at no cost. 100% money-back guarantee within the first 30 days!' },
        bot_default: { vi: 'Cảm ơn bạn đã quan tâm! Bạn có thể đăng ký dùng thử miễn phí hoặc tôi có thể tư vấn thêm về các gói dịch vụ. Bạn muốn biết thêm gì?', en: 'Thank you for your interest! You can sign up for a free trial or I can tell you more about our plans. What would you like to know?' }
    };

    var currentLang = localStorage.getItem('landing_lang') || 'vi';

    function applyTranslations(lang) {
        currentLang = lang;
        localStorage.setItem('landing_lang', lang);

        // Update flag & code
        var flagEl = document.getElementById('langFlag');
        var codeEl = document.getElementById('langCode');
        if (flagEl) flagEl.textContent = lang === 'vi' ? '🇻🇳' : '🇺🇸';
        if (codeEl) codeEl.textContent = lang.toUpperCase();

        // Update page title
        document.title = lang === 'vi'
            ? 'ReelsFlow AI | Nền Tảng Quản Lý Content Đa Kênh Với AI'
            : 'ReelsFlow AI | Multi-Channel Content Management Platform With AI';

        // Update all elements with data-i18n
        document.querySelectorAll('[data-i18n]').forEach(function(el) {
            var key = el.getAttribute('data-i18n');
            if (translations[key] && translations[key][lang]) {
                if (el.tagName === 'INPUT') {
                    el.placeholder = translations[key][lang];
                } else {
                    el.innerHTML = translations[key][lang];
                }
            }
        });

        // Update chat input placeholder
        var chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.placeholder = lang === 'vi' ? 'Nhập tin nhắn...' : 'Type a message...';
        }

        // Update typing phrases
        window._typingPhrases = lang === 'vi'
            ? ['Facebook Reels', 'Instagram Stories', 'TikTok Videos', 'YouTube Shorts', 'Bài đăng Group']
            : ['Facebook Reels', 'Instagram Stories', 'TikTok Videos', 'YouTube Shorts', 'Group Posts'];
    }

    function getBotReply(msg) {
        var lower = msg.toLowerCase();
        var pairs;
        if (currentLang === 'vi') {
            pairs = [
                ['giá', translations.bot_price.vi],
                ['miễn phí', translations.bot_free.vi],
                ['pro', translations.bot_pro.vi],
                ['enterprise', translations.bot_enterprise.vi],
                ['dùng thử', translations.bot_trial.vi],
                ['thử', translations.bot_trial.vi],
                ['an toàn', translations.bot_safety.vi],
                ['kết nối', translations.bot_connect.vi],
                ['hủy', translations.bot_cancel.vi],
                ['pricing', translations.bot_price.vi],
                ['free', translations.bot_free.vi],
                ['trial', translations.bot_trial.vi],
                ['safe', translations.bot_safety.vi],
                ['connect', translations.bot_connect.vi],
                ['cancel', translations.bot_cancel.vi]
            ];
        } else {
            pairs = [
                ['giá', translations.bot_price.en],
                ['miễn phí', translations.bot_free.en],
                ['pricing', translations.bot_price.en],
                ['free', translations.bot_free.en],
                ['pro', translations.bot_pro.en],
                ['enterprise', translations.bot_enterprise.en],
                ['trial', translations.bot_trial.en],
                ['dùng thử', translations.bot_trial.en],
                ['an toàn', translations.bot_safety.en],
                ['safe', translations.bot_safety.en],
                ['kết nối', translations.bot_connect.en],
                ['connect', translations.bot_connect.en],
                ['hủy', translations.bot_cancel.en],
                ['cancel', translations.bot_cancel.en]
            ];
        }
        for (var i = 0; i < pairs.length; i++) {
            if (lower.indexOf(pairs[i][0]) !== -1) {
                return pairs[i][1];
            }
        }
        return currentLang === 'vi' ? translations.bot_default.vi : translations.bot_default.en;
    }

    function initI18n() {
        // Apply saved language on load
        applyTranslations(currentLang);

        // Language toggle button
        var langBtn = document.getElementById('langToggle');
        if (langBtn) {
            langBtn.addEventListener('click', function() {
                var newLang = currentLang === 'vi' ? 'en' : 'vi';
                applyTranslations(newLang);
                // Re-init typing with new phrases
                if (window._typingInterval) clearInterval(window._typingInterval);
                restartTyping();
            });
        }
    }

    // ===== INIT ALL =====
    function init() {
        initParticles();
        initCursorGlow();
        initScrollReveal();
        initNavScroll();
        initMobileNav();
        initTypingEffect();
        initCounters();
        initPricingToggle();
        initFAQ();
        initSmoothScroll();
        initActiveNavLink();
        initHeroParallax();
        initChatBot();
        initI18n();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();