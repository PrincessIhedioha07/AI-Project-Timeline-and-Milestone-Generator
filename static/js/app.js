const app = {
    currentData: null,
    isLoginMode: true,
    currentUser: null,
    notifications: [], // Store notifications
    mockTemplates: [], // Store 20 templates

    init: async () => {
        // ... (Listeners preserved)
        document.getElementById('generateBtn').addEventListener('click', app.generatePlan);
        document.getElementById('authActionBtn').addEventListener('click', app.handleAuth);
        document.getElementById('authToggleBtn').addEventListener('click', app.toggleAuthMode);

        await app.checkAuthStatus();
        app.initTheme();
        app.generateMockTemplates();
        app.renderTemplates();

        // Templates Link Handler
        document.querySelector('a[href="#templates"]').onclick = (e) => {
            e.preventDefault();
            app.showTemplates();
        };

        // Click outside for Notification Dropdown
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('notificationDropdown');
            const btn = e.target.closest('button[onclick="app.toggleNotifications()"]');
            if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !btn) {
                dropdown.classList.add('hidden');
            }
        });

        // --- GSAP HERO ANIMATIONS ---
        if (window.gsap) {
            const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
            tl.from("main header", { y: -20, opacity: 0, duration: 0.8 })
                .from("#inputSection h1", { y: 20, opacity: 0, duration: 0.8 }, "-=0.6")
                .from("#inputSection p", { y: 20, opacity: 0, duration: 0.8 }, "-=0.6")
                .from("#inputSection .bg-surface", { scale: 0.95, opacity: 0, duration: 0.8 }, "-=0.6")
                .from("#inputSection .grid > div", { y: 20, opacity: 0, duration: 0.6, stagger: 0.1 }, "-=0.4");

            // Magnetic/Scale Hover Effect
            const buttons = document.querySelectorAll('button, .task-card');
            buttons.forEach(btn => {
                btn.addEventListener('mouseenter', () => gsap.to(btn, { scale: 1.02, duration: 0.3 }));
                btn.addEventListener('mouseleave', () => gsap.to(btn, { scale: 1, duration: 0.3 }));
            });
        }
    },

    // --- THEME ---
    initTheme: () => {
        const storedTheme = localStorage.getItem('theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (storedTheme === 'dark' || (!storedTheme && systemDark)) {
            document.documentElement.classList.add('dark');
            app.updateThemeUI(true);
        } else {
            document.documentElement.classList.remove('dark');
            app.updateThemeUI(false);
        }
    },

    // --- MOBILE SIDEBAR ---
    toggleMobileSidebar: () => {
        const sidebar = document.getElementById('mainSidebar');
        const overlay = document.getElementById('mobileOverlay');

        const isClosed = sidebar.classList.contains('-translate-x-full');

        if (isClosed) {
            // Open
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
            // Small delay to allow reflow so opacity transition triggers
            requestAnimationFrame(() => {
                overlay.classList.remove('opacity-0');
            });
        } else {
            // Close
            sidebar.classList.add('-translate-x-full');
            overlay.classList.add('opacity-0');
            setTimeout(() => {
                overlay.classList.add('hidden');
            }, 300); // Match transition duration
        }
    },

    toggleTheme: () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        app.updateThemeUI(isDark);
    },

    updateThemeUI: (isDark) => {
        const icon = document.getElementById('themeIcon');
        const text = document.getElementById('themeText');
        if (icon && text) {
            icon.innerText = isDark ? 'light_mode' : 'dark_mode';
            text.innerText = isDark ? 'Light Mode' : 'Dark Mode';
        }
    },

    // --- NOTIFICATIONS ---
    toggleNotifications: () => {
        const dropdown = document.getElementById('notificationDropdown');
        dropdown.classList.toggle('hidden');

        // Clear badge on open
        if (!dropdown.classList.contains('hidden')) {
            const badge = document.getElementById('notificationBadge');
            badge.classList.add('hidden');
        }
    },

    clearNotifications: () => {
        app.notifications = [];
        app.updateNotificationDropdown();
    },

    showNotification: (message, type = 'info') => {
        // 1. Add to history
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        app.notifications.unshift({ message, type, time: timestamp });
        if (app.notifications.length > 10) app.notifications.pop(); // keep last 10

        // 2. Update Badge & Dropdown
        const badge = document.getElementById('notificationBadge');
        if (document.getElementById('notificationDropdown').classList.contains('hidden')) {
            badge.classList.remove('hidden');
        }
        app.updateNotificationDropdown();

        // 3. Show Toast
        const container = document.getElementById('notificationContainer');
        const toast = document.createElement('div');

        const icons = { success: 'check_circle', error: 'error', info: 'info' };
        const iconName = icons[type] || 'info';

        const baseClasses = "flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border animate-fade-in bg-surface min-w-[300px] z-[100]";
        const typeClasses = {
            success: "border-green-500/20 text-green-700",
            error: "border-red-500/20 text-red-700",
            info: "border-blue-500/20 text-blue-700",
            neutral: "border-gray-200 text-gray-700"
        };
        const variantClass = typeClasses[type] || typeClasses.info;
        toast.className = `${baseClasses} ${variantClass}`;

        const iconColors = { success: "text-green-500", error: "text-red-500", info: "text-blue-500" }
        const iconColor = iconColors[type] || "text-blue-500";

        toast.innerHTML = `
            <span class="material-symbols-outlined text-[20px] ${iconColor}">${iconName}</span>
            <span class="text-sm font-semibold flex-1">${message}</span>
        `;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    updateNotificationDropdown: () => {
        const list = document.getElementById('notificationList');
        if (!list) return;

        list.innerHTML = '';
        if (app.notifications.length === 0) {
            list.innerHTML = `<div class="p-4 text-center text-text-muted text-xs">No notifications yet</div>`;
            return;
        }

        app.notifications.forEach(n => {
            const el = document.createElement('div');
            el.className = "flex items-start gap-3 p-3 border-b border-border-light hover:bg-gray-50 transition-colors";

            const iconColors = { success: "text-green-500", error: "text-red-500", info: "text-blue-500" };
            const icon = { success: 'check_circle', error: 'error', info: 'info' }[n.type] || 'info';

            el.innerHTML = `
                 <span class="material-symbols-outlined text-[16px] mt-0.5 ${iconColors[n.type]}">${icon}</span>
                 <div class="flex-1">
                     <p class="text-xs font-semibold text-text-main leading-snug">${n.message}</p>
                     <p class="text-[10px] text-text-muted mt-1">${n.time}</p>
                 </div>
            `;
            list.appendChild(el);
        });
    },

    // --- MOCK TEMPLATES ---
    generateMockTemplates: () => {
        const topics = ["SaaS Launch", "Mobile App", "Marketing Campaign", "Wedding Plan", "Website Redesign", "E-commerce Store", "Product Hunt Launch", "Podcast Series", "YouTube Channel", "Fitness App"];
        const styles = ["Agile", "Waterfall", "Kanban", "Scrum"];

        for (let i = 1; i <= 20; i++) {
            const topic = topics[i % topics.length];
            const style = styles[i % styles.length];
            app.mockTemplates.push({
                id: i,
                title: `${topic} V${Math.ceil(i / 3)}`,
                description: `A comprehensive ${style} template for executing a ${topic}. Includes pre-defined milestones and risk analysis.`,
                tags: [style, "Template"],
                color: ["blue", "purple", "green", "orange"][i % 4]
            });
        }
    },

    renderTemplates: () => {
        const grid = document.getElementById('templatesGrid');
        if (!grid) return;
        grid.innerHTML = '';
        app.mockTemplates.forEach(t => {
            const card = document.createElement('div');
            card.className = "bg-surface border border-border-light rounded-xl p-6 hover:shadow-lg hover:border-brand-purple/50 transition-all cursor-pointer group flex flex-col";
            card.onclick = () => {
                app.loadTemplate(t);
            };

            const badgeColor = {
                blue: "bg-blue-100 text-blue-700",
                purple: "bg-purple-100 text-purple-700",
                green: "bg-green-100 text-green-700",
                orange: "bg-orange-100 text-orange-700"
            }[t.color];

            card.innerHTML = `
                <div class="flex items-start justify-between mb-4">
                    <div class="w-10 h-10 rounded-lg ${badgeColor} flex items-center justify-center">
                        <span class="material-symbols-outlined">folder_open</span>
                    </div>
                    <span class="material-symbols-outlined text-border-light group-hover:text-brand-purple transition-colors">arrow_forward</span>
                </div>
                <h3 class="font-bold text-text-main text-lg mb-2 group-hover:text-brand-purple transition-colors">${t.title}</h3>
                <p class="text-xs text-text-muted leading-relaxed mb-4 flex-1">${t.description}</p>
                <div class="flex gap-2">
                    ${t.tags.map(tag => `<span class="px-2 py-1 bg-main-bg rounded text-[10px] font-bold text-text-muted uppercase tracking-wider">${tag}</span>`).join('')}
                </div>
            `;
            grid.appendChild(card);
        });
    },

    resetView: () => {
        // Soft reset for New Roadmap
        document.getElementById('inputSection').classList.remove('hidden');
        document.getElementById('resultSection').classList.add('hidden');
        document.getElementById('templatesSection').classList.add('hidden');

        // Clear data
        app.currentData = null;
        document.getElementById('timelineContainer').innerHTML = '';
        document.getElementById('projectDesc').value = '';
        document.getElementById('deadline').value = '';

        // Reset Title
        document.getElementById('pageTitle').innerText = "New Roadmap";
    },

    showTemplates: () => {
        document.getElementById('inputSection').classList.add('hidden');
        document.getElementById('resultSection').classList.add('hidden');
        document.getElementById('templatesSection').classList.remove('hidden');

        // Clean up ghost content
        document.getElementById('timelineContainer').innerHTML = '';

        // Update Title
        document.getElementById('pageTitle').innerText = "Templates Library";
    },

    loadTemplate: (template) => {
        document.getElementById('templatesSection').classList.add('hidden');
        document.getElementById('inputSection').classList.remove('hidden');
        document.getElementById('projectDesc').value = `Based on Template: ${template.title}\n${template.description}`;
        document.getElementById('pageTitle').innerText = "New Roadmap";
        app.showNotification(`Loaded template: ${template.title}`, "success");
    },


    // --- AUTH ---
    checkAuthStatus: async () => {
        try {
            const res = await fetch('/auth_status');
            const data = await res.json();
            if (data.logged_in) {
                app.currentUser = data.username;
                const userAvatar = document.getElementById('userAvatar');
                if (data.profile_pic) {
                    userAvatar.innerHTML = `<img src="${data.profile_pic}" class="w-full h-full rounded-full object-cover">`;
                    userAvatar.classList.remove('bg-brand-purple'); // Remove background color if image exists
                } else {
                    userAvatar.innerText = app.currentUser.charAt(0).toUpperCase();
                }

                app.updateHeaderState(true);
                app.showNotification(`Welcome back, ${data.username}!`, "success");
            } else {
                app.updateHeaderState(false);
            }
        } catch (e) { console.error(e); }
    },

    updateHeaderState: (isLoggedIn) => {
        const authButtons = document.getElementById('authButtons');
        const userMenu = document.getElementById('userMenu');
        const historyLink = document.getElementById('historyLink');

        if (isLoggedIn) {
            authButtons.classList.add('hidden');
            userMenu.classList.remove('hidden');
            userMenu.classList.add('flex');
            historyLink.classList.remove('hidden');
            historyLink.classList.add('flex');

            document.getElementById('displayUsername').innerText = app.currentUser;
            document.getElementById('userAvatar').innerText = app.currentUser.charAt(0).toUpperCase();
        } else {
            authButtons.classList.remove('hidden');
            userMenu.classList.add('hidden');
            userMenu.classList.remove('flex');
            historyLink.classList.add('hidden');
            historyLink.classList.remove('flex');
        }
    },

    showAuthModal: () => document.getElementById('authModal').classList.remove('hidden'),
    closeAuthModal: () => document.getElementById('authModal').classList.add('hidden'),

    toggleAuthMode: () => {
        app.isLoginMode = !app.isLoginMode;
        const title = document.getElementById('authTitle');
        const subtitle = document.getElementById('authSubtitle');
        const btn = document.getElementById('authActionBtn');
        const toggle = document.getElementById('authToggleBtn');

        if (app.isLoginMode) {
            title.innerText = 'Welcome Back';
            subtitle.innerText = 'Login to access your projects.';
            btn.innerText = 'Log In';
            toggle.innerText = "Don't have an account? Sign Up";
        } else {
            title.innerText = 'Create Workspace';
            subtitle.innerText = 'Join to start planning projects.';
            btn.innerText = 'Sign Up';
            toggle.innerText = "Already have an account? Log In";
        }
    },

    handleAuth: async () => {
        const username = document.getElementById('authUsername').value;
        const password = document.getElementById('authPassword').value;

        if (!username || !password) return app.showNotification("Please fill in all fields", "error");

        const endpoint = app.isLoginMode ? '/login' : '/register';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (res.ok) {
                app.currentUser = data.username;
                app.updateHeaderState(true);
                app.closeAuthModal();
                app.showNotification(app.isLoginMode ? "Logged in successfully!" : "Account created!", "success");
            } else {
                app.showNotification(data.error || "Authentication failed", "error");
            }
        } catch (e) {
            console.error(e);
            app.showNotification("An error occurred", "error");
        }
    },

    logout: async () => {
        await fetch('/logout', { method: 'POST' });
        app.currentUser = null;
        app.updateHeaderState(false);
        app.showNotification("Logged out successfully", "neutral");
        setTimeout(() => location.reload(), 1000);
    },

    showHistory: async () => {
        try {
            const res = await fetch('/history');
            const data = await res.json();

            const list = document.getElementById('historyList');
            list.innerHTML = '';

            if (data.length === 0) {
                list.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-12 text-center">
                        <span class="material-symbols-outlined text-4xl text-gray-300 mb-2">history_edu</span>
                        <p class="text-text-muted text-sm">No project history found.</p>
                    </div>`;
            }

            data.forEach(item => {
                const el = document.createElement('div');
                el.className = 'bg-white p-4 rounded-lg border border-border-light hover:border-brand-purple/50 cursor-pointer transition-all hover:shadow-sm group';
                el.onclick = () => app.loadProject(item.id);
                el.innerHTML = `
                    <div class="flex justify-between items-center mb-1">
                        <h4 class="font-bold text-text-main group-hover:text-brand-purple transition-colors">${item.title}</h4>
                        <span class="text-xs text-text-muted bg-gray-100 px-2 py-1 rounded">${item.date}</span>
                    </div>
                    <p class="text-xs text-text-muted truncate">${item.summary}</p>
                `;
                list.appendChild(el);
            });

            document.getElementById('historyModal').classList.remove('hidden');
        } catch (e) { console.error(e); app.showNotification("Failed to load history", "error"); }
    },

    closeHistoryModal: () => document.getElementById('historyModal').classList.add('hidden'),

    loadProject: async (id) => {
        try {
            const res = await fetch(`/project/${id}`);
            const data = await res.json();
            app.currentData = data;
            app.closeHistoryModal();

            // Hide Templates if open
            document.getElementById('templatesSection').classList.add('hidden');

            document.getElementById('inputSection').classList.add('hidden');
            document.getElementById('resultSection').classList.remove('hidden');
            document.getElementById('pageTitle').innerText = data.project_title || "Project Details";
            app.renderResults(data);
            app.showNotification("Project loaded", "success");
        } catch (e) { console.error(e); app.showNotification("Failed to load project details", "error"); }
    },

    simulateLoadingSteps: () => {
        const stepsContainer = document.getElementById('loadingSteps');
        const progressBar = document.getElementById('loadingProgressBar');
        const progressText = document.getElementById('loadingProgressText');

        const steps = [
            { text: "Verifying project scope...", color: "text-blue-400" },
            { text: "Allocating AI resources...", color: "text-purple-400" },
            { text: "Analyzing risk factors...", color: "text-orange-400" },
            { text: "Calculating critical path...", color: "text-green-400" }
        ];

        stepsContainer.innerHTML = '';
        let stepIndex = 0;
        let progress = 0;

        // Reset
        progressBar.style.width = '0%';
        progressText.innerText = '0%';

        // Smooth Progress Bar Interval (0 to 90%)
        const progressInterval = setInterval(() => {
            if (progress < 90) {
                // Add random increments for realism
                const increment = Math.random() * 2;
                progress = Math.min(progress + increment, 90); // Cap at 90%
                progressBar.style.width = `${progress}%`;
                progressText.innerText = `${Math.round(progress)}%`;
            }
        }, 100);

        // Steps Interval
        const stepsInterval = setInterval(() => {
            if (stepIndex >= steps.length) return;
            const step = steps[stepIndex];
            const el = document.createElement('div');
            el.className = "flex items-center gap-3 text-xs text-slate-300 animate-fade-in";
            el.innerHTML = `
                <span class="material-symbols-outlined text-[14px] ${step.color}">check_circle</span>
                <span>${step.text}</span>
            `;
            stepsContainer.appendChild(el);
            stepIndex++;
        }, 1200);

        return { progressInterval, stepsInterval };
    },

    generatePlan: async () => {
        const desc = document.getElementById('projectDesc').value;
        const deadline = document.getElementById('deadline').value;

        if (!desc || !deadline) {
            app.showNotification("Please provide both a description and deadline.", "error");
            return;
        }

        document.getElementById('inputSection').classList.add('hidden');
        document.getElementById('loadingOverlay').classList.remove('hidden');
        document.getElementById('loadingOverlay').classList.add('flex');

        const loadingIntervals = app.simulateLoadingSteps();

        try {
            const response = await fetch('/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: desc, deadline: deadline })
            });
            const data = await response.json();

            clearInterval(loadingIntervals.progressInterval);
            clearInterval(loadingIntervals.stepsInterval);

            // Fast forward to 100%
            document.getElementById('loadingProgressBar').style.width = '100%';
            document.getElementById('loadingProgressText').innerText = '100%';

            if (data.error) throw new Error(data.error);

            app.currentData = data;

            setTimeout(() => {
                document.getElementById('loadingOverlay').classList.add('hidden');
                document.getElementById('loadingOverlay').classList.remove('flex');
                document.getElementById('resultSection').classList.remove('hidden');
                app.renderResults(data);
                app.showNotification("Timeline generated successfully!", "success");
            }, 500);

        } catch (error) {
            clearInterval(loadingIntervals.progressInterval);
            clearInterval(loadingIntervals.stepsInterval);
            console.error(error);
            app.showNotification("Generation failed: " + error.message, "error");

            document.getElementById('loadingOverlay').classList.add('hidden');
            document.getElementById('loadingOverlay').classList.remove('flex');
            document.getElementById('inputSection').classList.remove('hidden'); // Go back
        }
    },

    renderResults: (data) => {
        document.getElementById('resProjectTitle').innerText = data.project_title;
        document.getElementById('resExecSummary').innerText = data.executive_summary;

        if (data.risk_assessment) {
            const riskBanner = document.getElementById('riskBanner');
            riskBanner.classList.remove('hidden');
            document.getElementById('riskMessage').innerText = `${data.risk_assessment.message} Mitigation: ${data.risk_assessment.mitigation}`;
        }

        const container = document.getElementById('timelineContainer');
        container.innerHTML = ''; // Clear previous

        if (!data.phases) return;

        data.phases.forEach((phase, index) => {
            // New "ClickUp Task" style cards
            const card = document.createElement('div');
            card.className = "task-card relative p-6 cursor-pointer group";
            card.onclick = () => app.openModal(index);

            // Side Badge Color
            const colors = {
                blue: "bg-blue-500",
                purple: "bg-purple-500",
                green: "bg-green-500",
                orange: "bg-orange-500"
            };
            const barColor = colors[phase.color] || colors.blue;

            card.innerHTML = `
                <div class="absolute -left-[31px] top-6 w-4 h-4 rounded-full border-[3px] border-white ${barColor} shadow-sm z-10"></div>
                
                <div class="flex items-start justify-between mb-2">
                    <div class="flex items-center gap-2">
                         <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-text-muted border border-border-light">${phase.duration}</span>
                         <h3 class="text-base font-bold text-text-main group-hover:text-brand-purple transition-colors">${phase.name}</h3>
                    </div>
                    <span class="material-symbols-outlined text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">chevron_right</span>
                </div>
                
                <p class="text-sm text-text-muted leading-relaxed mb-4">${phase.description || ''}</p>
                
                <div class="flex items-center gap-4 border-t border-border-light pt-3">
                    <div class="flex items-center gap-1 text-xs text-text-muted">
                        <span class="material-symbols-outlined text-[16px]">check_circle</span>
                        <span>${phase.tasks ? phase.tasks.length : 0} Tasks</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });



        // GSAP Staggered Reveal
        if (window.gsap) {
            gsap.from(".task-card", {
                y: 30,
                opacity: 0,
                duration: 0.6,
                stagger: 0.1,
                ease: "power2.out",
                clearProps: "all"
            });
        }

        setTimeout(app.initObservers, 100);
    },

    openModal: (phaseIndex) => {
        const phase = app.currentData.phases[phaseIndex];

        document.getElementById('modalTitle').innerText = phase.name;
        document.getElementById('modalDuration').innerText = phase.duration;
        document.getElementById('modalInsight').innerText = phase.ai_insight || "No specific insights for this phase.";

        const taskContainer = document.getElementById('modalTasksList');
        taskContainer.innerHTML = '';

        phase.tasks.forEach((task, i) => {
            const taskEl = document.createElement('div');
            const avatars = [
                'https://lh3.googleusercontent.com/aida-public/AB6AXuCvB2ZoH8fYUqC5o1YERG0-Dyyv3I9M2vqiWIhaFUxXBHlwNMhpwhmviQIZ0SaPpKB5HG6NmkbvMbZ3c19_0mUsyd0TN1Mt1ce_cNGX_qtkysM6LyPM_ylcogiBTxLyfYOHYqEbODRtf3DGYrcCSD0N_sXjJETVlH5xjEKV_5AZZ5pgtttGDOngCd3GDxUJt82OBqKasQhIbOSLaX6HBdOP4RqpFIzGAnUyeftOTqFcZzHzX1Qpjt0pNMY6IBZ0DYgeIpJvGrINZUM',
                'https://lh3.googleusercontent.com/aida-public/AB6AXuDmGfeaCVbhpbU0meuZ86BMtVNEcaq3Ggg0bFL2jJoiV3lAd7ptkAqJPpm1E0oQf5RIAVLQtL3iYaj0d7vyv2QOVMWUwQ7yIbvHM0IQN8KlKIl4RPYS_ejUqYvDwgpS5UBaD0t08e9clyflPakpo1EdB_Lzevjwx2P6BN6nhzcVyKdftPo7G3FgweUuJ2iAzHu7-wI2-Vfu96X0wV0RBnUiVrGF8rn8u41TcpWsZ-YeCVpK5oI6Dk_Ms-XJNV5OkuyVCx8YvPm_cJk'
            ];
            const avatar = avatars[i % avatars.length];

            taskEl.className = "group flex items-center gap-4 p-4 hover:bg-white/5 transition-colors cursor-pointer select-none border-b border-white/5 last:border-b-0";

            taskEl.onclick = (e) => {
                if (e.target.type !== 'checkbox') {
                    const cb = taskEl.querySelector('.task-checkbox');
                    cb.checked = !cb.checked;
                }
            };

            taskEl.innerHTML = `
                <div class="relative flex items-center justify-center shrink-0">
                    <input type="checkbox" class="task-checkbox peer h-5 w-5 rounded border-slate-600 bg-transparent text-primary focus:ring-0 focus:ring-offset-0 transition-all checked:bg-primary checked:border-primary cursor-pointer" />
                </div>
                <div class="flex-1 flex flex-col">
                    <span class="text-slate-200 group-hover:text-white transition-colors peer-checked:line-through peer-checked:text-slate-500">${task.name}</span>
                    <span class="text-xs text-slate-500">Scheduled task</span>
                </div>
                <div class="h-8 w-8 rounded-full bg-cover bg-center ring-2 ring-[#151b26] grayscale opacity-50 shrink-0" style="background-image: url('${avatar}');"></div>
            `;
            taskContainer.appendChild(taskEl);
        });

        document.getElementById('modalOverlay').classList.remove('hidden');
    },

    checkAllTasks: () => {
        const checkboxes = document.querySelectorAll('.task-checkbox');
        let allChecked = true;
        checkboxes.forEach(cb => { if (!cb.checked) allChecked = false; });
        checkboxes.forEach(cb => { cb.checked = !allChecked; });
        app.showNotification(allChecked ? "Unchecked all tasks" : "All tasks checked", "info");
    },

    closeModal: () => document.getElementById('modalOverlay').classList.add('hidden'),

    // --- EXPORT LOGIC ---
    exportTimeline: () => {
        const data = app.currentData;
        if (!data) return app.showNotification("No data to export", "error");

        app.showNotification("Generating PDF...", "info");

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // --- TITLE ---
            doc.setFontSize(22);
            doc.setTextColor(40, 40, 40);
            doc.text(data.project_title || "Project Timeline", 14, 20);

            // --- EXECUTIVE SUMMARY ---
            doc.setFontSize(11);
            doc.setTextColor(80, 80, 80);
            const splitSummary = doc.splitTextToSize(data.executive_summary || "", 180);
            doc.text(splitSummary, 14, 30);

            let finalY = 30 + (splitSummary.length * 5) + 10;

            // --- RISK ASSESSMENT ---
            if (data.risk_assessment) {
                doc.setFontSize(14);
                doc.setTextColor(200, 50, 0); // Orange/Red
                doc.text("Risk Assessment", 14, finalY);
                finalY += 6;

                doc.setFontSize(10);
                doc.setTextColor(60, 60, 60);
                const riskText = `Level: ${data.risk_assessment.level}\nMessage: ${data.risk_assessment.message}\nMitigation: ${data.risk_assessment.mitigation}`;
                const splitRisk = doc.splitTextToSize(riskText, 180);
                doc.text(splitRisk, 14, finalY);
                finalY += (splitRisk.length * 4) + 10;
            }

            // --- TIMELINE TABLE ---
            const tableBody = [];

            if (data.phases) {
                data.phases.forEach(phase => {
                    // Phase Header Row
                    tableBody.push([
                        { content: phase.name.toUpperCase(), colSpan: 4, styles: { fillColor: [240, 240, 240], fontStyle: 'bold', textColor: [50, 50, 50] } }
                    ]);

                    // Task Rows
                    if (phase.tasks) {
                        phase.tasks.forEach(task => {
                            tableBody.push([
                                phase.name, // Phase Name (Col 1)
                                task.name,  // Milestone/Task (Col 2)
                                phase.duration, // Duration (Col 3)
                                task.dependencies || "-" // Dependencies (Col 4)
                            ]);
                        });
                    }
                });
            }

            doc.autoTable({
                startY: finalY,
                head: [['Phase', 'Milestone/Task', 'Duration', 'Dependencies']],
                body: tableBody,
                theme: 'grid',
                headStyles: { fillColor: [123, 104, 238], textColor: 255, fontStyle: 'bold' }, // Brand Purple
                styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
                columnStyles: {
                    0: { fontStyle: 'bold', width: 40 },
                    1: { width: 70 },
                    2: { width: 30 },
                    3: { width: 40 }
                },
                margin: { top: 20, bottom: 20 }
            });

            // Footer
            const pageCount = doc.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(150);
                doc.text(`Page ${i} of ${pageCount} | Generated by TimelineAi`, 105, 290, { align: 'center' });
            }

            doc.save("project_roadmap.pdf");
            app.showNotification("PDF Exported Successfully!", "success");

        } catch (e) {
            console.error(e);
            app.showNotification("PDF Export Failed. Ensure jspdf is loaded.", "error");
        }
    }
};
document.addEventListener('DOMContentLoaded', app.init);
