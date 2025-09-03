const vscode = require("vscode");
const axios = require("axios");

/**
 * Tree Item for Collections & Fields
 */
class MockmanTreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState, command, iconPath) {
    super(label, collapsibleState);
    this.command = command;
    this.iconPath = iconPath;
  }
}

/**
 * Tree Data Provider
 */
class MockmanProvider {
  constructor() {
    this.collections = [];
  }

  async refresh() {
    const apiKey = vscode.workspace.getConfiguration().get("mockman.apiKey");
    if (!apiKey) {
      vscode.window.showErrorMessage("⚠️ Please login first (MockMan: Login).");
      this.collections = [];
      this._onDidChangeTreeData.fire();
      return;
    }

    try {
      const res = await axios.get(`https://mockman-express.onrender.com/collections/${apiKey}`);
      this.collections = res.data || [];
    } catch (error) {
      vscode.window.showErrorMessage("Error fetching collections: " + (error.response?.data?.message || error.message));
      this.collections = [];
    }

    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      // Root level → show collections
      return this.collections.map(
        (c) =>
          new MockmanTreeItem(
            c.collectionName,
            vscode.TreeItemCollapsibleState.Collapsed,
            null,
            new vscode.ThemeIcon("file-submodule")
          )
      );
    } else {
      // Inside a collection → show fields
      const collection = this.collections.find((col) => col.collectionName === element.label);
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

  _onDidChangeTreeData = new vscode.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
}

/**
 * Activate Extension
 */
async function activate(context) {
  console.log("MockMan Extension is active!");

  const provider = new MockmanProvider();
  vscode.window.registerTreeDataProvider("mockmanCollections", provider);

  // Sign Up Command
  let signupCommand = vscode.commands.registerCommand("mockman.signup", async function () {
    try {
      const username = await vscode.window.showInputBox({ prompt: "Enter your username" });
      const email = await vscode.window.showInputBox({ prompt: "Enter your email" });
      const password = await vscode.window.showInputBox({ prompt: "Enter your password", password: true });

      if (!username || !email || !password) {
        vscode.window.showErrorMessage("All fields are required!");
        return;
      }

      const res = await axios.post("https://mockman-express.onrender.com/auth/sign-up", {
        username,
        email,
        password,
      });

      if (res.data.apiSecretKey) {
        await vscode.workspace.getConfiguration().update("mockman.apiKey", res.data.apiSecretKey, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("🎉 Account created & Logged in successfully!");
        provider.refresh();
      } else {
        vscode.window.showErrorMessage("Sign Up failed: API Key not received.");
      }
    } catch (error) {
      vscode.window.showErrorMessage("Sign Up Error: " + error.message);
    }
  });

  // Login Command
  let loginCommand = vscode.commands.registerCommand("mockman.login", async function () {
    try {
      const email = await vscode.window.showInputBox({ prompt: "Enter your email" });
      const password = await vscode.window.showInputBox({ prompt: "Enter your password", password: true });

      if (!email || !password) {
        vscode.window.showErrorMessage("Email and Password required!");
        return;
      }

      const res = await axios.post("https://mockman-express.onrender.com/auth/login", {
        email,
        password,
      });

      if (res.data.apiSecretKey) {
        await vscode.workspace.getConfiguration().update("mockman.apiKey", res.data.apiSecretKey, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage("✅ Logged in successfully! API Key saved.");
        provider.refresh();
      } else {
        vscode.window.showErrorMessage("Login failed: API Key not received.");
      }
    } catch (error) {
      vscode.window.showErrorMessage("Login Error: " + error.message);
    }
  });

  // Refresh Command
  let refreshCommand = vscode.commands.registerCommand("mockman.refresh", async function () {
    await provider.refresh();
    vscode.window.showInformationMessage("🔄 Collections refreshed!");
  });

  context.subscriptions.push(signupCommand, loginCommand, refreshCommand);
}

function deactivate() {}

module.exports = { activate, deactivate };
