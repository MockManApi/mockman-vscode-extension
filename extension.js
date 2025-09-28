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
          case "copyToClipboard":
            try {
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.showInformationMessage(
                "Endpoint copied to clipboard!"
              );
            } catch (error) {
              vscode.window.showErrorMessage("Failed to copy endpoint.");
            }
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
        <style>
          * { box-sizing: border-box; }
          body { 
            background: var(--vscode-editor-background); 
            color: var(--vscode-editor-foreground); 
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 20px;
            line-height: 1.6;
          }
          
          .container {
            max-width: 100%;
            margin: 0 auto;
          }
          
          h1 {
            font-size: 24px;
            font-weight: 600;
            margin: 0 0 8px 0;
            color: var(--vscode-foreground);
          }
          
          .subtitle {
            color: var(--vscode-descriptionForeground);
            margin: 0 0 24px 0;
            font-size: 14px;
          }
          
          .base-url {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 20px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            color: var(--vscode-textPreformat-foreground);
          }
          
          .base-url strong {
            color: var(--vscode-textLink-foreground);
          }
          
          .section {
            margin: 24px 0;
          }
          
          .section-title {
            font-size: 16px;
            font-weight: 600;
            margin: 0 0 12px 0;
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
          }
          
          .endpoint {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 12px;
            margin: 8px 0;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          
          .endpoint:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
          }
          
          .method {
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            font-size: 11px;
            font-weight: 600;
            padding: 4px 8px;
            border-radius: 4px;
            text-transform: uppercase;
            min-width: 50px;
            text-align: center;
          }
          
          .method-get { background: #238636; color: white; }
          .method-post { background: #1f6feb; color: white; }
          .method-put { background: #fb8500; color: white; }
          .method-delete { background: #da3633; color: white; }
          
          .path {
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            font-size: 13px;
            color: #e6edf3;
            flex: 1;
            word-break: break-all;
          }
          
          .description {
            color: #8b949e;
            font-size: 13px;
            margin-left: auto;
            white-space: nowrap;
          }
          
          .copy-btn {
            background: none;
            border: none;
            color: #8b949e;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            transition: color 0.2s ease;
            flex-shrink: 0;
          }
          
          .copy-btn:hover {
            color: #58a6ff;
          }
          
          #dynamicEndpoints {
            max-height: 70vh;
            overflow-y: auto;
          }
          
          #dynamicEndpoints::-webkit-scrollbar {
            width: 8px;
          }
          
          #dynamicEndpoints::-webkit-scrollbar-track {
            background: #0d1117;
          }
          
          #dynamicEndpoints::-webkit-scrollbar-thumb {
            background: #30363d;
            border-radius: 4px;
          }
          
          #dynamicEndpoints::-webkit-scrollbar-thumb:hover {
            background: #484f58;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Collection Endpoints</h1>
          <p class="subtitle">Click any endpoint to copy the full URL to your clipboard</p>
          
          <div class="base-url">
            Base URL: <strong>${baseUrl}</strong>
          </div>
          
          <div id="dynamicEndpoints"></div>
        </div>
        
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const dynamicEndpoints = document.getElementById('dynamicEndpoints');
          const baseUrl = '${baseUrl}';
          
          function copyToClipboard(text) {
            vscode.postMessage({ command: 'copyToClipboard', text: text });
          }
          
          function escapeHtml(unsafe) {
            return unsafe
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
          }

          function createEndpoint(method, path, description, fullUrl) {
            const endpointDiv = document.createElement('div');
            endpointDiv.className = 'endpoint';
            endpointDiv.onclick = () => copyToClipboard(fullUrl);
            
            endpointDiv.innerHTML = \`
              <span class="method method-\${method.toLowerCase()}">\${method}</span>
              <span class="path">\${escapeHtml(path)}</span>
              <span class="description">\${escapeHtml(description)}</span>
              <button class="copy-btn" onclick="event.stopPropagation(); copyToClipboard('\${fullUrl}')" title="Copy endpoint">
                📋
              </button>
            \`;
            
            return endpointDiv;
          }

          function createSection(title) {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'section';
            
            const titleDiv = document.createElement('div');
            titleDiv.className = 'section-title';
            titleDiv.textContent = title;
            
            sectionDiv.appendChild(titleDiv);
            return sectionDiv;
          }
          
          window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'endpoints') {
              const data = message.data;
              
              dynamicEndpoints.innerHTML = '';
              
              // Collection Level
              const collectionSection = createSection('Collection Level');
              const collectionEndpoints = [
                {
                  method: 'GET',
                  path: \`/collections/\${data.apiKey}\`,
                  description: 'Get all collections',
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}\`
                },
                {
                  method: 'GET', 
                  path: \`/collections/\${data.apiKey}/by-name/\${data.collection.collectionName}\`,
                  description: 'Get collection by name',
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}/by-name/\${data.collection.collectionName}\`
                },
                {
                  method: 'GET',
                  path: \`/collections/\${data.apiKey}/\${data.collection._id}\`,
                  description: 'Get collection by ID', 
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}/\${data.collection._id}\`
                }
              ];
              
              collectionEndpoints.forEach(endpoint => {
                collectionSection.appendChild(createEndpoint(endpoint.method, endpoint.path, endpoint.description, endpoint.fullUrl));
              });
              
              dynamicEndpoints.appendChild(collectionSection);
              
              // Document Level
              const documentSection = createSection('Document Level');
              const documentEndpoints = [
                {
                  method: 'POST',
                  path: \`/collections/\${data.apiKey}/\${data.collection._id}/documents\`,
                  description: 'Add documents',
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}/\${data.collection._id}/documents\`
                },
                {
                  method: 'GET',
                  path: \`/collections/\${data.apiKey}/\${data.collection._id}/documents\`,
                  description: 'Get all documents',
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}/\${data.collection._id}/documents\`
                },
                {
                  method: 'GET',
                  path: \`/collections/\${data.apiKey}/\${data.collection._id}/documents/:documentId\`,
                  description: 'Get document by ID',
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}/\${data.collection._id}/documents/:documentId\`
                },
                {
                  method: 'PUT',
                  path: \`/collections/\${data.apiKey}/\${data.collection._id}/documents/:documentId\`,
                  description: 'Update document by ID',
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}/\${data.collection._id}/documents/:documentId\`
                },
                {
                  method: 'DELETE',
                  path: \`/collections/\${data.apiKey}/\${data.collection._id}/documents/:documentId\`,
                  description: 'Delete document by ID',
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}/\${data.collection._id}/documents/:documentId\`
                },
                {
                  method: 'DELETE',
                  path: \`/collections/\${data.apiKey}/\${data.collection._id}/documents\`,
                  description: 'Delete all documents',
                  fullUrl: \`\${baseUrl}/collections/\${data.apiKey}/\${data.collection._id}/documents\`
                }
              ];
              
              documentEndpoints.forEach(endpoint => {
                documentSection.appendChild(createEndpoint(endpoint.method, endpoint.path, endpoint.description, endpoint.fullUrl));
              });
              
              dynamicEndpoints.appendChild(documentSection);
              
            } else if (message.command === 'endpointsError') {
              dynamicEndpoints.innerHTML = '<div style="color: #f85149; padding: 16px; background: #161b22; border: 1px solid #30363d; border-radius: 6px;">' + escapeHtml(message.message) + '</div>';
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
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline' https:; script-src 'nonce-${nonce}';">
        <title>MockMan Templates</title>
        <style>
          * { box-sizing: border-box; }
          body { 
            background: var(--vscode-editor-background); 
            color: var(--vscode-editor-foreground); 
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 20px;
            line-height: 1.6;
          }
          
          .container {
            max-width: 100%;
            margin: 0 auto;
          }
          
          h1 {
            font-size: 24px;
            font-weight: 600;
            margin: 0 0 8px 0;
            color: var(--vscode-foreground);
          }
          
          .subtitle {
            color: var(--vscode-descriptionForeground);
            margin: 0 0 24px 0;
            font-size: 14px;
          }
          
          .section {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            margin: 16px 0;
            overflow: hidden;
          }
          
          .section-title {
            font-size: 16px;
            font-weight: 600;
            margin: 0;
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
          }
          
          .section-content {
            padding: 16px;
          }
          
          .form-group {
            margin-bottom: 16px;
          }
          
          .form-group label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 6px;
            color: var(--vscode-foreground);
          }
          
          .form-control {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            color: var(--vscode-input-foreground);
            font-size: 14px;
            transition: border-color 0.2s ease;
            font-family: var(--vscode-font-family);
          }
          
          .form-control:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
          }
          
          .btn {
            display: inline-flex;
            align-items: center;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s ease;
            border: none;
            font-family: var(--vscode-font-family);
          }
          
          .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          
          .btn-primary:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
          }
          
          .btn-primary:disabled {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: not-allowed;
          }
          
          .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-input-border);
          }
          
          .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }
          
          .json-preview {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 12px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            max-height: 300px;
            overflow-y: auto;
            white-space: pre-wrap;
            color: var(--vscode-textPreformat-foreground);
          }
          
          .json-preview::-webkit-scrollbar {
            width: 8px;
          }
          
          .json-preview::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
          }
          
          .json-preview::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-activeBackground);
            border-radius: 4px;
          }
          
          .json-preview::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
          }
          
          .error-message {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-errorForeground);
            padding: 12px;
            border-radius: 4px;
            margin: 12px 0;
          }
          
          .success-message {
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-foreground);
            padding: 12px;
            border-radius: 4px;
            margin: 12px 0;
          }
          
          .form-row {
            display: flex;
            gap: 12px;
            align-items: flex-end;
          }
          
          .form-row .form-group {
            margin-bottom: 0;
          }
          
          .input-number {
            width: 100px;
          }
          
          .loader {
            display: none;
            width: 14px;
            height: 14px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top: 2px solid var(--vscode-focusBorder);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-left: 8px;
          }
          
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          .btn-loading .loader {
            display: inline-block;
          }
          
          .help-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>MockMan Template Browser</h1>
          <p class="subtitle">Browse 50+ templates, preview schemas, and create collections with fake data.</p>
          
          <div id="loginPrompt" class="error-message" style="display: none;">
            <p>⚠️ Please login to access templates. <button id="loginBtn" class="btn btn-secondary">Login Now</button></p>
          </div>
          
          <div class="section" id="templateSection" style="display: none;">
            <div class="section-title">Select Template</div>
            <div class="section-content">
              <div class="form-group">
                <label for="templateSelect">Template Category</label>
                <select id="templateSelect" class="form-control">
                  <option value="">Choose a template category...</option>
                </select>
              </div>
            </div>
          </div>
          
          <div class="section" id="previewSection" style="display: none;">
            <div class="section-title">Schema Preview</div>
            <div class="section-content">
              <div id="preview" class="json-preview">Select a template to view its schema</div>
            </div>
          </div>
          
          <div class="section" id="createSection" style="display: none;">
            <div class="section-title">Create Collection</div>
            <div class="section-content">
              <div class="form-row">
                <div class="form-group">
                  <label for="rowCount">Records</label>
                  <input id="rowCount" type="number" min="1" max="500" value="10" class="form-control input-number">
                </div>
                <button id="createBtn" class="btn btn-primary">
                  <span id="createText">Create Collection</span>
                  <span id="createLoader" class="loader"></span>
                </button>
              </div>
              <div class="help-text">Max 500 records. Generated data will appear in your Collections sidebar.</div>
            </div>
          </div>
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
                preview.textContent = JSON.stringify(message.data, null, 2);
                break;
              case 'createSuccess':
                createBtn.classList.remove('btn-loading');
                createBtn.disabled = false;
                createText.textContent = 'Create Collection';
                break;
              case 'error':
                createBtn.classList.remove('btn-loading');
                createBtn.disabled = false;
                createText.textContent = 'Create Collection';
                loginPrompt.innerHTML = '<p>⚠️ ' + escapeHtml(message.message) + ' <button id="loginBtn" class="btn btn-secondary">Login Now</button></p>';
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
              document.getElementById('preview').textContent = 'Select a template to view its schema';
            }
          });
          
          document.getElementById('createBtn')?.addEventListener('click', () => {
            const category = document.getElementById('templateSelect').value;
            const count = parseInt(document.getElementById('rowCount').value);
            if (category && count >= 1 && count <= 500) {
              createBtn.disabled = true;
              createBtn.classList.add('btn-loading');
              createText.textContent = 'Creating...';
              vscode.postMessage({ command: 'createCollection', category, count });
            } else {
              vscode.postMessage({ command: 'showError', message: 'Please select a template and enter a valid row count (1-500).' });
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

  provider.refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
