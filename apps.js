const appsData = [
    { name: "Livingroom", icon: "🛋️", link: "#", id: "livingroomLink" },
    { name: "Stickers", icon: "🏷️", link: "stickers" },
    { name: "Editor", icon: "🎨", link: "editor" },
    { name: "Objects", icon: "🪨", link: "objects" },
    { name: "Scroll", icon: "📄", link: "scroll" },
    { name: "Realities", icon: "📷", link: "realities" },
    { name: "Chaos", icon: "🌀", link: "chaos" },
    { name: "Space", icon: "🌌", link: "space", hidden: true },
    { name: "Jams", icon: "🎵", link: "jams" },
    { name: "Midi", icon: "🎹", link: "midi" },
    { name: "BrokenNes", icon: "🕹️", link: "brokennes" },
    { name: "Ask", icon: "🍷", link: "ask", hidden: true }
];

function renderApps() {
    const grid = document.querySelector('.features-grid');
    if (!grid) {
        console.error('Features grid not found');
        return;
    }
    grid.innerHTML = ''; // Clear existing content

    appsData.forEach(app => {
        if (app.hidden) return;

        const a = document.createElement('a');
        a.href = app.link;
        a.className = 'feature-card';
        if (app.id) {
            a.id = app.id;
        }

        const iconSpan = document.createElement('span');
        iconSpan.className = 'feature-icon';
        iconSpan.textContent = app.icon;

        const titleH3 = document.createElement('h3');
        titleH3.className = 'feature-title';
        titleH3.textContent = app.name;

        a.appendChild(iconSpan);
        a.appendChild(titleH3);
        grid.appendChild(a);
    });
}
