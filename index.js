const axios = require('axios');
const fs = require('fs');
const { Parser } = require('json2csv');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('orgName', {
    alias: 'o',
    type: 'string',
    description: 'Name of the organization',
    demandOption: true
  })
  .option('token', {
    alias: 't',
    type: 'string',
    description: 'GitHub token',
    demandOption: true
  })
  .argv;

let githubToken = argv.token || process.env.GITHUB_TOKEN;
let orgName = argv.orgName || process.env.ORG_NAME;

// Check if the required parameters are provided
if (!githubToken || !orgName) {
  console.error('Usage: gh gh-branch-protection-report --token <githubToken> --orgName <orgName>');
  console.error('Or set the GITHUB_TOKEN and ORG_NAME environment variables.');
  process.exit(1);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const axiosInstance = axios.create({
  baseURL: 'https://api.github.com/',
  timeout: 10000,
  headers: { 'Authorization': `token ${githubToken}` }
});

axiosInstance.interceptors.response.use((response) => {
  // Check the rate limit headers
  const remaining = response.headers['x-ratelimit-remaining'];
  if (remaining && remaining === '0') {
    const resetTime = response.headers['x-ratelimit-reset'];
    const currentTime = Math.floor(new Date().getTime() / 1000);
    const delay = resetTime - currentTime;

    // Delay the next request
    return new Promise((resolve) => {
      setTimeout(() => resolve(response), delay * 1000);
      console.log(`Rate limit reached, sleeping for ${delay} seconds...`);
    });
  }

  return response;
}, (error) => {
  return Promise.reject(error);
});

async function getRepos(orgName) {
    let response;
    let repos = [];
    let url = `https://api.github.com/orgs/${orgName}/repos?per_page=100`;

    while (url) {
        try {
            response = await axiosInstance.get(url);
        } catch (error) {
        if (error.response && error.response.status === 403) {
            console.log('Rate limit reached, sleeping for 1 minute...');
            await sleep(60000);
            continue;
        } else {
            throw error;
        }
        }

        repos = repos.concat(response.data);

        if (response.headers.link) {
        let links = response.headers.link.split(', ');
        let nextLink = links.find(link => link.endsWith('rel="next"'));
        
        if (nextLink) {
            url = nextLink.slice(nextLink.indexOf('<') + 1, nextLink.indexOf('>'));
        } else {
            url = null;
        }
        } else {
        url = null;
        }
    }

    return repos;
}

function removeUrlsFromObject(obj) {
    let newObj = Array.isArray(obj) ? [] : {};
  
    for (let key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        newObj[key] = removeUrlsFromObject(obj[key]);
      } else if (typeof obj[key] !== 'string' || !obj[key].startsWith('http')) {
        newObj[key] = obj[key];
      }
    }
  
    return newObj;
}

async function getBranchProtectionRules(repo) {
    let response;
  
    try {
      response = await axiosInstance.get(`https://api.github.com/repos/${orgName}/${repo.name}/branches/${repo.default_branch}/protection`);
    } catch (error) {
      if (error.response && error.response.status === 404) {
          // Branch is not protected
          return { name: repo.default_branch, protection: { enabled: false } };
      } else {
          throw error;
      }
    }

    let parsedProtection = {
        // required_pull_request_reviews_count: response.data.required_pull_request_reviews.required_approving_review_count,
        required_pull_request_reviews: response.data.required_pull_request_reviews? true : false,
        required_pull_request_reviews_count: response.data.required_pull_request_reviews ? response.data.required_pull_request_reviews.required_approving_review_count : 0,
        required_pull_request_reviews_code_owners: response.data.required_pull_request_reviews ? response.data.required_pull_request_reviews.require_code_owner_reviews : false,
        required_signatures: response.data.required_signatures,
        enforce_admins: response.data.enforce_admins,
        restrictions: response.data.restrictions ? true : false,
        required_linear_history: response.data.required_linear_history,
        allow_force_pushes: response.data.allow_force_pushes,
        allow_deletions: response.data.allow_deletions,
        block_creations: response.data.block_creations,
        required_conversation_resolution: response.data.required_conversation_resolution,
        lock_branch: response.data.lock_branch,
        allow_fork_syncing: response.data.allow_fork_syncing
        // restrictions_length: response.data.restrictions ? response.data.restrictions.length : 0
    };

    let finalProtection = removeUrlsFromObject(parsedProtection);
    
    return { name: response.data.name, protection: finalProtection };
}

async function getOrgOwners(orgName) {
  const response = await axiosInstance.get(`https://api.github.com/orgs/${orgName}/members?role=admin`);
  return response.data.map(user => user.login);
}

async function getRepoAdmins(repo) {

  const response = await axiosInstance.get(`https://api.github.com/repos/${orgName}/${repo.name}/collaborators?permission=admin`);
  const admins = response.data
    .filter(user => user.permissions.admin)
    .map(user => user.login);

  return admins.join('; ');
}

async function main() {
  if (!githubToken || !orgName) {
    console.error('Error: Missing required parameters.');
    console.error('Usage: node index.js --token <githubToken> --orgName <orgName>');
    console.error('Or set the GITHUB_TOKEN and ORG_NAME environment variables.');
    process.exit(1);
  }

  // Validate GitHub token and check if organization exists
  let url = `https://api.github.com/orgs/${orgName}`;
  while (url) {
    try {
      await axiosInstance.get(url);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.error('Error: Invalid GitHub token.');
        process.exit(1);
      } else if (error.response && error.response.status === 404) {
        console.error(`Error: Organization ${orgName} does not exist.`);
        process.exit(1);
      } else if (error.response && error.response.status === 403) {
        console.log('Rate limit reached, sleeping for 1 minute...');
        await sleep(60000);
        continue;
      } else {
        console.error('Error: An unknown error occurred.');
        throw error;
      }
    }
    url = null;
  }

  let orgOwners = await getOrgOwners(orgName);
  orgOwners = orgOwners.map(owner => owner.toLowerCase());
  console.log(`Org Owners: ${orgOwners}`);
  const repos = await getRepos(orgName);
  console.log(`Total Repos: ${repos.length}`);

  const date = new Date();
  const dateString = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const timeString = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
  const fileName = `${orgName}-${dateString}_${timeString}-branch-protection-report.csv`;
  fs.writeFileSync(fileName, 'repo,branch,enabled,required_pull_request_reviews_count,required_pull_request_reviews_code_owners,restrictions,required_signatures,enforce_admins,required_linear_history,allow_force_pushes,allow_deletions,block_creations,admins \n');


  for (const repo of repos) {
    const rule = await getBranchProtectionRules(repo);
    let admins = await getRepoAdmins(repo);
    admins = admins.split(';').map(admin => admin.trim().toLowerCase());
    admins = admins.filter(admin => !orgOwners.includes(admin));
    admins = admins.join(';');
    console.log(`Branch Protection Rules for ${repo.name}`);

    const parser = new Parser({ header: false });
    let csv = parser.parse({ 
      repo: repo.name,
      branch: repo.default_branch,
      enabled: (rule.protection.enabled == false ? false : true),
      required_pull_request_reviews_count: rule.protection.required_pull_request_reviews_count,
      required_pull_request_reviews_code_owners: rule.protection.required_pull_request_reviews_code_owners,
      restrictions: rule.protection.restrictions,
      required_signatures: (rule.protection.required_signatures) ? rule.protection.required_signatures.enabled : undefined,
      enforce_admins: (rule.protection.enforce_admins) ? rule.protection.enforce_admins.enabled : undefined,
      required_linear_history: (rule.protection.required_linear_history) ? rule.protection.required_linear_history.enabled : undefined,
      allow_force_pushes: (rule.protection.allow_force_pushes) ? rule.protection.allow_force_pushes.enabled : undefined,
      allow_deletions: (rule.protection.allow_deletions) ? rule.protection.allow_deletions.enabled : undefined,
      block_creations: (rule.protection.block_creations) ? rule.protection.block_creations.enabled : undefined,
      // required_conversation_resolution: rule.protection.required_conversation_resolution,
      // lock_branch: rule.protection.lock_branch,
      // allow_fork_syncing: rule.protection.allow_fork_syncing,
      admins: admins 
    });

    csv = csv.replace(/"/g, '');

    fs.appendFileSync(fileName, csv + '\n');

  }
}

main().catch(console.error);