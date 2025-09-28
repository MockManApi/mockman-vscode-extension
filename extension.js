const vscode = require("vscode");
const axios = require("axios");

/**
 * Tree Item for Collections & Fields
 */
class MockmanTreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState, command, iconPath, collectionData) {
    super(label, collapsibleState);
    this.command = command;
    this.iconPath = iconPath;
    this.collectionData = collectionData; // Store collection data for endpoints
    this.contextValue = collectionData ? "collection" : "field"; // For context menu
  }
}

/**
 * Tree Data Provider
 */
class MockmanProvider {
  constructor(context) {
    this.context = context;
    this.collections = [];
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.apiKey = null;
  }

  async getApiKey() {
    if (this.apiKey) return this.apiKey;
    this.apiKey = await this.context.secrets.get("mockman.apiKey");
    return this.apiKey;
  }

  async refresh() {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      this.collections = [];
      this._onDidChangeTreeData.fire();
      return;
    }

    try {
      const res = await axios.get(
        `https://api.mockman.online/collections/${apiKey}`,
        { timeout: 5000 }
      );
      this.collections = res.data || [];
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error fetching collections: ${error.message}`
      );
      this.collections = [];
    }

    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      return this.collections.map(
        (c) =>
          new MockmanTreeItem(
            c.collectionName,
            vscode.TreeItemCollapsibleState.Collapsed,
            {
              command: "mockman.showEndpoints",
              title: "Show Endpoints",
              arguments: [c],
            },
            new vscode.ThemeIcon("file-submodule"),
            c
          )
      );
    } else {
      const collection = this.collections.find(
        (col) => col.collectionName === element.label
      );
      if (!collection) return [];

      return collection.fields.map(
        (f) =>
          new MockmanTreeItem(
            `${f.fieldName} (${f.fieldType})`,
            vscode.TreeItemCollapsibleState.None,
            null,
            new vscode.ThemeIcon("symbol-field")
          )
      );
    }
  }
}

/**
 * Webview for Endpoints
 */
class EndpointsWebview {
  constructor(context, provider) {
    this.context = context;
    this.provider = provider;
    this.panel = null;
  }

  async show(collection) {
    const title = `Endpoints for ${collection.collectionName}`;
    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal();
      this.updateContent(collection);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "mockmanEndpoints",
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = await this.getWebviewContent();
    this.panel.onDidDispose(
      () => {
        this.panel = null;
      },
      null,
      this.context.subscriptions
    );

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "showInfo":
            vscode.window.showInformationMessage(message.message);
            break;
          case "showError":
            vscode.window.showErrorMessage(message.message);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    this.updateContent(collection);
  }

  async updateContent(collection) {
    const apiKey = await this.provider.getApiKey();
    if (!apiKey || !this.panel) return;

    // No need to fetch documents since we're showing patterns only
    this.panel.webview.postMessage({
      command: "endpoints",
      data: {
        collection,
        apiKey,
      },
    });
  }

  async getWebviewContent() {
    const nonce = getNonce();
    const baseUrl = "https://api.mockman.online";
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline' https:; script-src 'nonce-${nonce}';">
        <title>MockMan Endpoints</title>
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
        <style>
          body { background-color: #1a1a1a; color: #ffffff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
          .endpoint { background-color: #2d2d2d; padding: 0.75rem; margin: 0.5rem 0; border-radius: 0.5rem; cursor: pointer; transition: background-color 0.2s; display: flex; justify-content: space-between; align-items: center; word-break: break-all; }
          .endpoint:hover { background-color: #3d3d3d; }
          .endpoint strong { color: #60a5fa; margin-right: 0.5rem; }
          .endpoint-description { flex-grow: 1; margin-left: 1rem; font-size: 0.875rem; word-break: break-all; }
          .copy-btn { background: none; border: none; color: #60a5fa; cursor: pointer; font-size: 1rem; padding: 0 0.5rem; flex-shrink: 0; }
          .error-msg { color: #ef4444; padding: 1rem; background: #2d2d2d; border-radius: 0.5rem; margin: 1rem 0; }
          #dynamicEndpoints { max-height: 60vh; overflow-y: auto; }
        </style>
      </head>
      <body class="p-4 sm:p-6 max-w-full mx-auto overflow-x-hidden">
        <div class="mb-6">
          <h1 class="text-xl sm:text-2xl font-bold mb-4 text-white">Collection Endpoints</h1>
          <p class="text-sm text-gray-400 mb-4">Base URL: <strong>${baseUrl}</strong><br>Click to copy full URLs (use :collectionId, :apiKey, :documentId as placeholders).</p>
        </div>
        <div id="dynamicEndpoints" class="space-y-2 w-full"></div>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const dynamicEndpoints = document.getElementById('dynamicEndpoints');
          const baseUrl = '${baseUrl}';
          function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
              vscode.postMessage({ command: 'showInfo', message: 'Endpoint copied to clipboard!' });
            }).catch(err => {
              vscode.postMessage({ command: 'showError', message: 'Failed to copy endpoint.' });
            });
          }
          function escapeHtml(unsafe) {
            return unsafe
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
          }
          window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'endpoints') {
              const data = message.data;
              let endpointHtml = '<h3 class="text-lg font-semibold mb-2 text-gray-300">Collection Level</h3>';
              endpointHtml += [
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '\\')">',
                  '<span><strong>GET</strong> /collections/' + escapeHtml(data.apiKey) + '</span>',
                  '<span class="endpoint-description">Get all collections</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '\\')">📋</button>',
                '</div>',
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/by-name/' + escapeHtml(data.collection.collectionName) + '\\')">',
                  '<span><strong>GET</strong> /collections/' + escapeHtml(data.apiKey) + '/by-name/' + escapeHtml(data.collection.collectionName) + '</span>',
                  '<span class="endpoint-description">Get collection by name</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/by-name/' + escapeHtml(data.collection.collectionName) + '\\')">📋</button>',
                '</div>',
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '\\')">',
                  '<span><strong>GET</strong> /collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '</span>',
                  '<span class="endpoint-description">Get collection by ID</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '\\')">📋</button>',
                '</div>'
              ].join('');
              endpointHtml += '<h3 class="text-lg font-semibold mt-4 mb-2 text-gray-300">Document Level</h3>';
              endpointHtml += [
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents\\')">',
                  '<span><strong>POST</strong> /collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents</span>',
                  '<span class="endpoint-description">Add documents</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents\\')">📋</button>',
                '</div>',
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents\\')">',
                  '<span><strong>GET</strong> /collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents</span>',
                  '<span class="endpoint-description">Get all documents</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents\\')">📋</button>',
                '</div>',
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId\\')">',
                  '<span><strong>GET</strong> /collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId</span>',
                  '<span class="endpoint-description">Get document by ID</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId\\')">📋</button>',
                '</div>',
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId\\')">',
                  '<span><strong>PUT</strong> /collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId</span>',
                  '<span class="endpoint-description">Update document by ID</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId\\')">📋</button>',
                '</div>',
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId\\')">',
                  '<span><strong>DELETE</strong> /collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId</span>',
                  '<span class="endpoint-description">Delete document by ID</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents/:documentId\\')">📋</button>',
                '</div>',
                '<div class="endpoint" onclick="copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents\\')">',
                  '<span><strong>DELETE</strong> /collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents</span>',
                  '<span class="endpoint-description">Delete all documents</span>',
                  '<button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard(\\'' + baseUrl + '/collections/' + escapeHtml(data.apiKey) + '/' + escapeHtml(data.collection._id) + '/documents\\')">📋</button>',
                '</div>'
              ].join('');
              dynamicEndpoints.innerHTML = endpointHtml;
            } else if (message.command === 'endpointsError') {
              dynamicEndpoints.innerHTML = '<div class="text-red-500 p-4">' + escapeHtml(message.message) + '</div>';
            }
          });
        </script>
      </body>
      </html>
    `;
  }
}

/**
 * Webview for Template Browser
 */
class TemplateBrowserWebview {
  constructor(context, provider) {
    this.context = context;
    this.provider = provider;
    this.panel = null;
  }

  async show() {
    const apiKey = await this.provider.getApiKey();
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "mockmanTemplateBrowser",
      "MockMan Templates",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = await this.getWebviewContent();
    this.panel.onDidDispose(
      () => {
        this.panel = null;
      },
      null,
      this.context.subscriptions
    );

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        const apiKey = await this.provider.getApiKey();
        switch (message.command) {
          case "login":
            vscode.commands.executeCommand("mockman.login");
            break;
          case "getTemplates":
            if (!apiKey) {
              this.showLoginError();
              return;
            }
            try {
              const templateRes = await axios.get(
                `https://api.mockman.online/templates/${apiKey}`,
                { timeout: 5000 }
              );
              this.panel.webview.postMessage({
                command: "templates",
                data: templateRes.data.templates,
              });
            } catch (error) {
              this.handleError(error, "fetching templates");
            }
            break;
          case "getPreview":
            if (!apiKey) {
              this.showLoginError();
              return;
            }
            try {
              const previewRes = await axios.get(
                `https://api.mockman.online/templates/${apiKey}/${message.category}/preview`,
                { timeout: 5000 }
              );
              this.panel.webview.postMessage({
                command: "preview",
                data: previewRes.data,
              });
            } catch (error) {
              this.handleError(error, "fetching preview");
            }
            break;
          case "createCollection":
            if (!apiKey) {
              this.showLoginError();
              return;
            }
            try {
              const createRes = await axios.post(
                `https://api.mockman.online/templates/${apiKey}/create`,
                {
                  category: message.category,
                  count: message.count,
                },
                { timeout: 10000 }
              );
              this.panel.webview.postMessage({
                command: "createSuccess",
                data: createRes.data,
              });
              vscode.window.showInformationMessage(
                `✅ Collection "${createRes.data.collection.name}" created with ${createRes.data.collection.documentCount} documents`
              );
              vscode.commands.executeCommand("mockman.refresh");
            } catch (error) {
              this.handleError(error, "creating collection");
            }
            break;
          case "showInfo":
            vscode.window.showInformationMessage(message.message);
            break;
          case "showError":
            vscode.window.showErrorMessage(message.message);
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    if (!apiKey) {
      this.panel.webview.postMessage({ command: "noApiKey" });
    } else {
      this.panel.webview.postMessage({ command: "getTemplates" });
    }
  }

  showLoginError() {
    vscode.window.showErrorMessage("⚠️ Please login first (MockMan: Login).");
    this.panel.webview.postMessage({
      command: "error",
      message: "Please login first (MockMan: Login).",
    });
  }

  handleError(error, action) {
    const errorMessage = error.response?.data?.message || error.message;
    vscode.window.showErrorMessage(`Error ${action}: ${errorMessage}`);
    this.panel.webview.postMessage({ command: "error", message: errorMessage });
  }

  async getWebviewContent() {
    const nonce = getNonce();
    const baseUrl = "https://api.mockman.online";
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline' https:; script-src 'nonce-${nonce}';">
        <title>MockMan Templates</title>
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
        <style>
          body { background-color: #1a1a1a; color: #ffffff; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
          .json-view { background-color: #2d2d2d; padding: 1rem; border-radius: 0.5rem; max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 0.875rem; }
          .loader { display: none; width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #60a5fa; border-radius: 50%; animation: spin 0.8s linear infinite; margin-left: 0.5rem; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          .btn-loading { opacity: 0.7; cursor: not-allowed; }
          .error-msg { color: #ef4444; padding: 1rem; background: #2d2d2d; border-radius: 0.5rem; margin: 1rem 0; }
        </style>
      </head>
      <body class="p-4 sm:p-6 max-w-full mx-auto overflow-x-hidden">
        <div class="mb-6">
          <h1 class="text-2xl sm:text-3xl font-bold mb-4 text-white">MockMan Template Browser</h1>
          <p class="text-gray-400">Browse 50+ templates, preview schemas, and create collections with fake data.</p>
          <div id="loginPrompt" class="error-msg" style="display: none;">
            <p>⚠️ Please login to access templates. <button id="loginBtn" class="text-blue-400 underline cursor-pointer">Login Now</button></p>
          </div>
        </div>
        <div class="mb-6" id="templateSection" style="display: none;">
          <h2 class="text-xl font-semibold mb-2 text-gray-300">Select Template</h2>
          <select id="templateSelect" class="w-full p-3 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Choose a template category...</option>
          </select>
        </div>
        <div class="mb-6" id="previewSection" style="display: none;">
          <h2 class="text-xl font-semibold mb-2 text-gray-300">Schema Preview</h2>
          <div id="preview" class="json-view border border-gray-600"></div>
        </div>
        <div class="mb-8" id="createSection" style="display: none;">
          <h2 class="text-xl font-semibold mb-3 text-gray-300">Create Collection</h2>
          <div class="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
            <input id="rowCount" type="number" min="1" max="1000" value="10" class="w-full sm:w-24 p-3 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Rows">
            <button id="createBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg flex items-center transition-colors disabled:opacity-50">
              <span id="createText">Create Collection</span>
              <span id="createLoader" class="loader"></span>
            </button>
          </div>
          <p class="text-sm text-gray-500 mt-2">Max 1000 rows. Generated data will appear in your Collections sidebar.</p>
        </div>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const createBtn = document.getElementById('createBtn');
          const createText = document.getElementById('createText');
          const createLoader = document.getElementById('createLoader');
          const loginPrompt = document.getElementById('loginPrompt');
          const templateSection = document.getElementById('templateSection');
          const previewSection = document.getElementById('previewSection');
          const createSection = document.getElementById('createSection');
          function escapeHtml(unsafe) {
            return unsafe
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
          }
          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
              case 'templates':
                templateSection.style.display = 'block';
                previewSection.style.display = 'block';
                createSection.style.display = 'block';
                loginPrompt.style.display = 'none';
                const select = document.getElementById('templateSelect');
                select.innerHTML = '<option value="">Choose a template category...</option>';
                message.data.forEach(template => {
                  const option = document.createElement('option');
                  option.value = template.category;
                  option.textContent = escapeHtml(template.displayName);
                  select.appendChild(option);
                });
                break;
              case 'preview':
                const preview = document.getElementById('preview');
                preview.innerHTML = '<pre>' + escapeHtml(JSON.stringify(message.data, null, 2)) + '</pre>';
                break;
              case 'createSuccess':
                createBtn.classList.remove('btn-loading');
                createBtn.disabled = false;
                createText.textContent = 'Create Collection';
                createLoader.style.display = 'none';
                break;
              case 'error':
                createBtn.classList.remove('btn-loading');
                createBtn.disabled = false;
                createText.textContent = 'Create Collection';
                createLoader.style.display = 'none';
                loginPrompt.innerHTML = '<p>' + escapeHtml(message.message) + ' <button id="loginBtn" class="text-blue-400 underline cursor-pointer">Login Now</button></p>';
                loginPrompt.style.display = 'block';
                templateSection.style.display = 'none';
                previewSection.style.display = 'none';
                createSection.style.display = 'none';
                document.getElementById('loginBtn').addEventListener('click', () => {
                  vscode.postMessage({ command: 'login' });
                });
                break;
              case 'noApiKey':
                loginPrompt.style.display = 'block';
                templateSection.style.display = 'none';
                previewSection.style.display = 'none';
                createSection.style.display = 'none';
                document.getElementById('loginBtn').addEventListener('click', () => {
                  vscode.postMessage({ command: 'login' });
                });
                break;
            }
          });
          document.getElementById('templateSelect')?.addEventListener('change', (e) => {
            const category = e.target.value;
            if (category) {
              vscode.postMessage({ command: 'getPreview', category });
            } else {
              document.getElementById('preview').innerHTML = '';
            }
          });
          document.getElementById('createBtn')?.addEventListener('click', () => {
            const category = document.getElementById('templateSelect').value;
            const count = parseInt(document.getElementById('rowCount').value);
            if (category && count >= 1 && count <= 1000) {
              createBtn.disabled = true;
              createBtn.classList.add('btn-loading');
              createText.textContent = 'Creating...';
              createLoader.style.display = 'inline-block';
              vscode.postMessage({ command: 'createCollection', category, count });
            } else {
              vscode.postMessage({ command: 'showError', message: 'Please select a template and enter a valid row count (1-1000).' });
            }
          });
          vscode.postMessage({ command: 'getTemplates' });
        </script>
      </body>
      </html>
    `;
  }
}

/**
 * Generate a nonce for CSP
 */
function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Activate Extension
 */
async function activate(context) {
  const provider = new MockmanProvider(context);
  vscode.window.registerTreeDataProvider("mockmanCollections", provider);

  const templateBrowser = new TemplateBrowserWebview(context, provider);
  const endpointsWebview = new EndpointsWebview(context, provider);

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path === "/callback") {
          const queryParams = new URLSearchParams(uri.query);
          const apiKey = queryParams.get("apikey");
          if (apiKey && apiKey.length > 0 && /^[a-f0-9]+$/.test(apiKey)) {
            context.secrets
              .store("mockman.apiKey", apiKey.trim())
              .then(() => {
                provider.apiKey = apiKey.trim();
                return vscode.workspace
                  .getConfiguration("mockman")
                  .update(
                    "apiKey",
                    apiKey.trim(),
                    vscode.ConfigurationTarget.Global
                  );
              })
              .then(() => {
                vscode.window.showInformationMessage(
                  "✅ API Key saved successfully!"
                );
                provider.refresh();
              })
              .catch((error) => {
                vscode.window.showErrorMessage(
                  "⚠️ Failed to save API Key: " + error.message
                );
              });
          } else {
            vscode.window.showErrorMessage("⚠️ Invalid API Key format.");
          }
        } else {
          vscode.window.showErrorMessage("⚠️ Invalid redirect path.");
        }
      },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mockman.login", async () => {
      const loginUrl = `https://mockman.online/login`;
      const success = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
      if (!success) {
        vscode.window
          .showWarningMessage(
            `Could not open browser. Please visit ${loginUrl} manually.`,
            "Copy URL"
          )
          .then((selection) => {
            if (selection === "Copy URL") {
              vscode.env.clipboard.writeText(loginUrl);
            }
          });
      }
    }),
    vscode.commands.registerCommand("mockman.refresh", async () => {
      await provider.refresh();
      vscode.window.showInformationMessage("🔄 Collections refreshed!");
    }),
    vscode.commands.registerCommand("mockman.templates", async () => {
      await templateBrowser.show();
    }),
    vscode.commands.registerCommand(
      "mockman.showEndpoints",
      async (collection) => {
        if (!collection) {
          vscode.window.showErrorMessage("No collection selected.");
          return;
        }
        await endpointsWebview.show(collection);
      }
    )
  );

  // Immediate refresh to ensure sidebar is populated
  provider.refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
