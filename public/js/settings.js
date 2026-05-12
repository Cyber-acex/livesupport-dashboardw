document.addEventListener('DOMContentLoaded', () => {
  const theme = localStorage.getItem('theme') || 'Light';
  applyTheme(theme);

  // Load sidebar preferences
  loadSidebarSettings();

  // Load font size
  const savedFontSize = localStorage.getItem('fontSize') || '100';
  applyFontSize(savedFontSize);
  const fontSizeRange = document.getElementById('fontSizeRange');
  if (fontSizeRange) fontSizeRange.value = savedFontSize;

  // Optional: update the appearance select in settings page
  const themeSelect = document.getElementById('theme');
  if (themeSelect) themeSelect.value = theme;

  const sidebarPositionSelect = document.getElementById('sidebarPosition');
  const sidebarWidthSelect = document.getElementById('sidebarWidth');
  
  if (sidebarPositionSelect) {
    sidebarPositionSelect.value = localStorage.getItem('sidebarPosition') || 'left';
  }
  
  if (sidebarWidthSelect) {
    sidebarWidthSelect.value = localStorage.getItem('sidebarWidth') || 'standard';
  }
});

function applyTheme(theme) {
  if (theme === 'Dark') {
    document.body.style.background = '#1e1e1e';
    document.body.style.color = '#ffffff';
  } else {
    document.body.style.background = '#ffffff';
    document.body.style.color = '#000000';
  }
}

/**
 * Apply sidebar position and width settings
 */
function applySidebarLayout(position, width) {
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.main');
  const backBtn = document.querySelector('.topbar .back-btn');

  if (!sidebar) return;

  sidebar.classList.remove('position-left', 'position-right', 'position-collapsed');
  sidebar.classList.remove('width-narrow', 'width-standard', 'width-wide');
  sidebar.classList.add(`position-${position}`);
  sidebar.classList.add(`width-${width}`);

  if (main) {
    if (position === 'right') {
      main.style.setProperty('margin-left', '0', 'important');
      main.style.marginRight = width === 'narrow' ? '160px' : width === 'wide' ? '280px' : '220px';
    } else if (position === 'collapsed') {
      main.style.setProperty('margin-left', '68px', 'important');
      main.style.marginRight = '0';
    } else {
      main.style.setProperty('margin-left', width === 'narrow' ? '160px' : width === 'wide' ? '280px' : '220px', 'important');
      main.style.marginRight = '0';
    }
  }

  if (backBtn) {
    if (position === 'right') {
      backBtn.style.left = '16px';
    } else if (position === 'collapsed') {
      backBtn.style.left = 'calc(68px + 16px)';
    } else {
      backBtn.style.left = width === 'narrow' ? 'calc(160px + 16px)' : width === 'wide' ? 'calc(280px + 16px)' : 'calc(220px + 16px)';
    }
  }
}

function applyFontSize(size) {
  const numericSize = Number(size) || 100;
  document.documentElement.style.setProperty('--base-font-size', numericSize + '%');
  localStorage.setItem('fontSize', numericSize.toString());

  const label = document.getElementById('fontSizeLabel');
  if (label) {
    const labelText = {
      90: 'Compact (90%)',
      100: 'Normal (100%)',
      110: 'Large (110%)',
      120: 'Extra Large (120%)'
    }[numericSize] || `${numericSize}%`;
    label.textContent = labelText;
  }
}

function applySidebarSettings() {
  const position = document.getElementById('sidebarPosition')?.value || 'left';
  const width = document.getElementById('sidebarWidth')?.value || 'standard';

  applySidebarLayout(position, width);
  localStorage.setItem('sidebarPosition', position);
  localStorage.setItem('sidebarWidth', width);
}

/**
 * Load sidebar settings from localStorage and apply them
 */
function loadSidebarSettings() {
  const savedPosition = localStorage.getItem('sidebarPosition') || 'left';
  const savedWidth = localStorage.getItem('sidebarWidth') || 'standard';

  applySidebarLayout(savedPosition, savedWidth);

  const positionSelect = document.getElementById('sidebarPosition');
  const widthSelect = document.getElementById('sidebarWidth');

  if (positionSelect) positionSelect.value = savedPosition;
  if (widthSelect) widthSelect.value = savedWidth;
}