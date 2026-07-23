const { execSync } = require('child_process');

console.log("Starting push for frontend...");
try {
  const out1 = execSync('git push --force frontend-page temp-frontend:main', { cwd: 'd:\\mb bloods', encoding: 'utf-8', stdio: 'pipe' });
  console.log("Frontend Push Result:", out1);
} catch (err) {
  console.error("Frontend Push Error:", err.stdout ? err.stdout : err.message, err.stderr ? err.stderr : '');
}

console.log("Starting push for backend...");
try {
  const out2 = execSync('git push --force backend-repo temp-backend:main', { cwd: 'd:\\mb bloods', encoding: 'utf-8', stdio: 'pipe' });
  console.log("Backend Push Result:", out2);
} catch (err) {
  console.error("Backend Push Error:", err.stdout ? err.stdout : err.message, err.stderr ? err.stderr : '');
}

console.log("Starting push for admin frontend...");
try {
  const out3 = execSync('git push --force admin-frontend-repo temp-admin-frontend:main', { cwd: 'd:\\mb bloods', encoding: 'utf-8', stdio: 'pipe' });
  console.log("Admin Frontend Push Result:", out3);
} catch (err) {
  console.error("Admin Frontend Push Error:", err.stdout ? err.stdout : err.message, err.stderr ? err.stderr : '');
}
