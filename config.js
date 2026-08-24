// Smart Attendance System — Frontend Configuration
// ============================================================
// After deploying the Google Apps Script backend as a Web App,
// paste the deployment URL below. It should end with /exec.
//
// This is the ONLY place the API URL should be set. Every page
// includes this file and reads APP_CONFIG.API_URL.
// ============================================================

const APP_CONFIG = Object.freeze({
  API_URL: "https://script.google.com/macros/s/AKfycbxwcMG1u_k5cs3rYAZIYkjFSXtfD6As83aiYF4lc2Nsrrn1h8c87KQYXTLkFlryQH5x/exec"
});

function isApiConfigured() {
  return Boolean(
    APP_CONFIG.API_URL &&
    APP_CONFIG.API_URL.startsWith('https://script.google.com/') &&
    !APP_CONFIG.API_URL.includes('https://script.google.com/macros/s/AKfycbxwcMG1u_k5cs3rYAZIYkjFSXtfD6As83aiYF4lc2Nsrrn1h8c87KQYXTLkFlryQH5x/exec')
  );
}

function getApiNotConfiguredMessage() {
  return 'The attendance service is not configured yet. Please contact the administrator.';
}
