const { execSync } = require('child_process');

function splitAndPush(prefix, branchName, remoteRepo) {
  console.log(`\n--- Splitting and pushing ${prefix} (${branchName} -> ${remoteRepo}:main) ---`);
  try {
    try {
      execSync(`git branch -D ${branchName}`, { cwd: 'd:\\mb bloods', stdio: 'ignore' });
    } catch (e) {}
    console.log(`Generating git subtree for ${prefix}...`);
    execSync(`git subtree split --prefix=${prefix} -b ${branchName}`, { cwd: 'd:\\mb bloods', stdio: 'inherit' });
    console.log(`Pushing ${branchName} to ${remoteRepo}...`);
    const out = execSync(`git push --force ${remoteRepo} ${branchName}:main`, { cwd: 'd:\\mb bloods', encoding: 'utf-8', stdio: 'pipe' });
    console.log(`Result:`, out.trim() || 'Success');
  } catch (err) {
    console.error(`Error:`, err.stdout ? err.stdout : err.message, err.stderr ? err.stderr : '');
  }
}

splitAndPush('frontend', 'temp-frontend', 'frontend-page');
splitAndPush('backend', 'temp-backend', 'backend-repo');
splitAndPush('admin-frontend', 'temp-admin-frontend', 'admin-frontend-repo');
splitAndPush('admin-backend', 'temp-admin-backend', 'admin-backend-repo');

