const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs");
const archiver = require("archiver");
const axios = require("axios");

const context = github.context;
const { owner, repo } = context.repo;
const { number } = context.payload.issue;

async function postComment(message) {
    try {
        const token = core.getInput('github-token');
        const octokit = github.getOctokit(token);

        await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: number,
            body: message
        });
    } catch (error) {
        console.error(`Failed to post comment: ${message}`, error);
    }
}

function createZip(sourceDir) {
    return new Promise((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 9 } });
        const output = fs.createWriteStream(`file.zip`);

        archive.directory(sourceDir, false);
        archive.pipe(output);

        output.on('close', () => {
            console.log(`Successfully created file.zip`);
            resolve();
        });

        archive.on('error', reject);
        archive.finalize();
    });
}

async function sendZipToExternalAPI() {
    const url = "https://app.pushpreview.com/api/previews/";
    const secretToken = core.getInput("pushpreview-token");
    const file = fs.createReadStream("file.zip");

    try {
        const response = await axios.post(url, {
            pr_identifier: number,
            organization: owner,
            repository_name: repo,
            origin_source: 'GitHub',
            file
        }, {
            headers: {
                'Content-Type': 'multipart/form-data',
                Authorization: `Api-Key ${secretToken}`
            }
        });

        console.log("Response from API:", response.data);
        return response.data.previewUrl;
    } catch (error) {
        console.error(error);
        core.setFailed(error.message);
        return null;
    }
}

async function main() {
    if (context.payload.issue.pull_request) {
        const sourceDir = core.getInput("source-directory");
        console.log(sourceDir);

        await postComment("⚙️ Hang tight! PushPreview is currently building your preview. We'll share the URL as soon as it's ready. ");

        if (!fs.existsSync(sourceDir)) {
            const errorMessage = `The source directory "${sourceDir}" does not exist.`;
            await postComment(`Workflow failed with the following error: ${errorMessage}`);
            core.setFailed(errorMessage);
            return;
        }

        try {
            await createZip(sourceDir);
            const previewUrl = await sendZipToExternalAPI();
            if (previewUrl) {
                await postComment(`🎉 Success! Your live preview is now available. Check it out here: ${previewUrl}`);
            }
        } catch (error) {
            await postComment(`Workflow failed with the following error: ${error.message}`);
            core.setFailed(error.message);
        }
    }
}

main();
