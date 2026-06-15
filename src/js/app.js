import { renderAll, bindEvents } from './ui.js';

function init() {
  bindEvents();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
