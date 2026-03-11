export const STORAGE_KEYS = {
    TASKS: 'flowtracker_tasks',
    SESSIONS: 'flowtracker_sessions',
    AIMS: 'flowtracker_aims',
    SETTINGS: 'flowtracker_settings',
    STATE: 'flowtracker_state',
    VERSION: 'flowtracker_version',
    NOTIFICATION_PROMPT: 'flowtracker_notification_prompt',
    PROFILE: 'flowtracker_profile'
};

export const CURRENT_VERSION = 1;

export const DEFAULT_FOCUS_AREAS = [
    // Education & Personal Development
    { name: "Course Work", category: "Education & Personal Development", color: "#a855f7" },
    { name: "E-learning / Online Courses", category: "Education & Personal Development", color: "#a855f7" },
    { name: "Exam Prep", category: "Education & Personal Development", color: "#a855f7" },
    { name: "Certification", category: "Education & Personal Development", color: "#a855f7" },
    { name: "Language Practice", category: "Education & Personal Development", color: "#a855f7" },
    { name: "Reading", category: "Education & Personal Development", color: "#a855f7" },
    
    // Health & Wellness
    { name: "Physical workout", category: "Health & Wellness", color: "#3fb950" },
    { name: "Meditation", category: "Health & Wellness", color: "#3fb950" },
    { name: "Yoga", category: "Health & Wellness", color: "#3fb950" },
    
    // Personal Life & Home
    { name: "Cleaning & Organizing", category: "Personal Life & Home", color: "#f97316" },
    { name: "Home Improvement & DIY", category: "Personal Life & Home", color: "#f97316" },
    { name: "Gardening", category: "Personal Life & Home", color: "#f97316" },
    { name: "Grocery Shopping & Cooking", category: "Personal Life & Home", color: "#f97316" },
    { name: "Family Time", category: "Personal Life & Home", color: "#f97316" },
    { name: "Pet Care", category: "Personal Life & Home", color: "#f97316" },
    
    // Work & Career
    { name: "Meetings", category: "Work & Career", color: "#58a6ff" },
    { name: "Client Work", category: "Work & Career", color: "#58a6ff" },
    { name: "Email Management", category: "Work & Career", color: "#58a6ff" },
    { name: "Coding", category: "Work & Career", color: "#58a6ff" },
    
    // Creative & Innovation
    { name: "Content Creation", category: "Creative & Innovation", color: "#ec4899" },
    { name: "Side Projects", category: "Creative & Innovation", color: "#ec4899" },

    // Leisure & Entertainment
    { name: "TV & Movies", category: "Leisure & Entertainment", color: "#eab308" },
    { name: "Music & Podcasts", category: "Leisure & Entertainment", color: "#eab308" },
    { name: "Gaming", category: "Leisure & Entertainment", color: "#eab308" },
    { name: "Social Media & YouTube", category: "Leisure & Entertainment", color: "#eab308" }
];

export const ACHIEVEMENTS = [
    { id: 'first_steps', title: 'First Steps', desc: 'Complete your first focus session', icon: '🌱', check: (state) => state.sessions.length >= 1 },
    { id: 'habitual', title: 'Habitual', desc: '3-day focus streak', icon: '🔥', check: (state) => {
        if (state.sessions.length === 0) return false;
        const getLogicalDate = (ts) => {
            const shifted = new Date(new Date(ts).getTime() - (4 * 60 * 60 * 1000));
            return shifted.toISOString().split('T')[0];
        };
        const dates = [...new Set(state.sessions.map(s => getLogicalDate(s.timestamp)))].sort((a, b) => b.localeCompare(a));
        let streak = 0; 
        const today = getLogicalDate(Date.now());
        const yesterday = getLogicalDate(Date.now() - 86400000);
        if (dates[0] !== today && dates[0] !== yesterday) return false;
        for (let i = 0; i < dates.length; i++) {
            if (i === 0) { streak = 1; continue; }
            const prev = new Date(dates[i-1]);
            const curr = new Date(dates[i]);
            if (Math.round((prev - curr) / 86400000) === 1) streak++;
            else break;
        }
        return streak >= 3;
    }},
    { id: 'deep_diver', title: 'Deep Diver', desc: '10 total hours focused', icon: '🌊', check: (state) => state.totalXp >= 600 },
    { id: 'night_owl', title: 'Night Owl', desc: 'Complete a session between 12 AM - 4 AM', icon: '🦉', hidden: true, check: (state) => state.sessions.some(s => {
        const h = new Date(s.timestamp).getHours();
        return h >= 0 && h < 4;
    })},
    { id: 'early_bird', title: 'Early Bird', desc: 'Start a session before 6 AM', icon: '🌅', hidden: true, check: (state) => state.sessions.some(s => {
        const h = new Date(s.timestamp).getHours();
        return h >= 4 && h < 6;
    })},
    { id: 'socialite', title: 'Socialite', desc: 'Share your progress', icon: '📤', check: (state) => state.unlockedAchievements.includes('socialite') },
    { id: 'architect', title: 'Architect', desc: 'Reach 10 unique focus targets', icon: '📐', check: (state) => state.aims.filter(a => {
        const spent = state.sessions.filter(s => s.taskId === a.focusAreaId && (!a.deadline || a.timestamp <= a.deadline)).reduce((acc, s) => acc + s.duration, 0);
        return spent >= a.targetMinutes * 60;
    }).length >= 10 },
    { id: 'unstoppable', title: 'Unstoppable', desc: '100 total hours focused', icon: '👑', check: (state) => state.totalXp >= 6000 }
];

export let state = {
    tasks: [],
    sessions: [],
    aims: [],
    settings: {
        workDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        sessionsBeforeLongBreak: 4,
        autoStartBreaks: false,
        autoStartWork: false,
        soundVolume: 70,
        use12Hour: false,
        cardVariant: 'glass',
        shareTemplates: {
            intent: "🧠 Focusing on {focusArea} for {duration} mins. Back at {time}! 🚀 #PomoFlow #DeepWork",
            session: "🎯 Session complete! Focused on {focusArea} for {duration} mins. Earned {xp} XP! 📈 #PomoFlow",
            milestone: "🏆 Focus Area target reached! Just hit my target for {focusArea}! {duration} minutes of deep work completed. 🎯 #PomoFlow #Intentionality",
            mood: "Current Mood: {avatar} {mood}\nFocus level: 🎯🎯🎯🎯🎯\nDistractions: 🚫\nIn the zone!\n#flowstate #productivity"
        }
    },
    currentTask: null,
    timerState: {
        mode: 'work',
        isRunning: false,
        remainingTime: 25 * 60,
        totalTime: 25 * 60,
        sessionCount: 0,
        cycleStation: 1,
        startTime: null,
        targetEndTime: null,
        activeTaskId: null
    },
    notificationPermission: 'default',
    lastSessionId: null,
    lastTaskId: null,
    selectedTaskColor: '#58a6ff',
    editTaskColor: '#58a6ff',
    selectedFocusAreaIds: [],
    categories: [
        { id: 'edu', name: "Education & Personal Development", icon: "🎓" },
        { id: 'health', name: "Health & Wellness", icon: "💪" },
        { id: 'home', name: "Personal Life & Home", icon: "🏠" },
        { id: 'work', name: "Work & Career", icon: "💼" },
        { id: 'creative', name: "Creative & Innovation", icon: "🎨" },
        { id: 'leisure', name: "Leisure & Entertainment", icon: "🍿" },
        { id: 'uncategorized', name: "Uncategorized", icon: "📁", isDefault: true }
    ],
    xp: 0,
    totalXp: 0,
    level: 1,
    avatar: '🦉',
    unlockedAchievements: [],
    collapsedCategories: [],
    activeCategoryIndex: 0,
    lastLogicalDate: null,
    lastRefreshTime: null
};

// State mutations
export const mutations = {
    updateState(updates) {
        Object.assign(state, updates);
    },
    updateSettings(updates) {
        Object.assign(state.settings, updates);
    },
    updateTimer(updates) {
        Object.assign(state.timerState, updates);
    }
};
