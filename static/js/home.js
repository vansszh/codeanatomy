import {
    wireHovers,
    wireMagnets,
    wireNavigation,
    wireScrollState,
} from './lib/motion.js';

wireScrollState({ chrome: document.querySelector('.chrome') });
wireNavigation(null);
wireHovers();
wireMagnets();
