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
    { id: 'first_steps', name: 'First Steps', desc: 'Complete your first focus session', icon: '🌱', type: 'bronze' },
    { id: 'habitual', name: 'Habitual', desc: '3-day focus streak', icon: '🔥', type: 'bronze' },
    { id: 'deep_diver', name: 'Deep Diver', desc: '10 total hours focused', icon: '🌊', type: 'silver' },
    { id: 'night_owl', name: 'Night Owl', desc: 'Complete a session between 12 AM - 4 AM', icon: '🦉', type: 'special', hidden: true },
    { id: 'early_bird', name: 'Early Bird', desc: 'Start a session before 6 AM', icon: '🌅', type: 'special', hidden: true },
    { id: 'socialite', name: 'Socialite', desc: 'Share your progress for the first time', icon: '📤', type: 'bronze' },
    { id: 'architect', name: 'Architect', desc: 'Reach 10 unique focus targets', icon: '📐', type: 'silver' },
    { id: 'unstoppable', name: 'Unstoppable', desc: '100 total hours focused', icon: '👑', type: 'gold' }
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
