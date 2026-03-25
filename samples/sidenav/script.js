document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('toggle-btn');
    const submenuToggles = document.querySelectorAll('.submenu-toggle');
    const searchInput = document.querySelector('.search-wrapper input');

    // Toggle Sidebar
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        
        // If expanding, we might want to ensure submenus stay in their state or reset?
        // Current CSS hides submenus when collapsed automatically.
    });

    // Submenu Toggle
    submenuToggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            // If sidebar is collapsed, expand it first
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
                // Give it a moment to expand before opening submenu, or just open it
                setTimeout(() => {
                    toggle.closest('.menu-item').classList.toggle('open');
                }, 300); // Wait for sidebar transition
            } else {
                toggle.closest('.menu-item').classList.toggle('open');
            }
        });
    });

    // Auto-expand on search focus
    searchInput.addEventListener('focus', () => {
        if (sidebar.classList.contains('collapsed')) {
            sidebar.classList.remove('collapsed');
        }
    });
    
    // Optional: Collapse on click outside on mobile? 
    // For now, let's keep it simple.
});
