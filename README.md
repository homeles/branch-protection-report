# GitHub Branch Protection Report

This is a command line tool that generates a report on the branch protection rules for all repositories in a GitHub organization.

## Installation

1. Clone this repository:
    ```bash
    git clone https://github.com/homeles/gh-branch-protection-report.git
    ```
2. Navigate to the project directory:
    ```bash
    cd gh-branch-protection-report
    ```
3. Install the dependencies:
    ```bash
    npm install
    ```

## Usage

You can run the tool with the `--orgName` and `--token` command line arguments:

```bash
node index.js --token <githubToken> --orgName <orgName>
```


Or you can set the `GITHUB_TOKEN` and `ORG_NAME` environment variables and run the tool without any arguments:

```
export GITHUB_TOKEN=<githubToken>
export ORG_NAME=<orgName>
node index.js
```

Replace `<githubToken>` with your GitHub token and `<orgName>` with the name of the GitHub organization.

## License
MIT