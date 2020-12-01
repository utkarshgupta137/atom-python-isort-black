const _ = require("lodash");

const { CompositeDisposable } = require("atom");

const { Formatter } = require("./formatter.js");
const config = require("./config.js");
const helpers = require("./helpers.js");
const services = require("./services.js");

const formatters = new Map();
const subscriptions = new CompositeDisposable();
let formatOrder = [];
let saveOrder = [];

let busySignal = null;
let statusBar = null;
const status = {
  editor: null,
  formatters,
  formatOrder,
  saveOrder,
  showTick: false,
  showTile: false,
};

function setFormatOrder(value) {
  const newFormatOrder = _.compact(value);
  if (_.isEqual(newFormatOrder, formatOrder)) {
    return;
  }

  if (
    newFormatOrder.some((name) => {
      if (formatters.has(name)) {
        return false;
      }
      helpers.handleError(
        `'${name}' is not a valid formatter name.`,
        `Invalid format order`
      );
      return true;
    })
  ) {
    formatOrder = [];
  } else {
    formatOrder = newFormatOrder;
  }
  services.updateStatusBarTooltip();
}

function setSaveOrder(value) {
  const newSaveOrder = _.compact(value);
  if (_.isEqual(newSaveOrder, saveOrder)) {
    return;
  }

  if (
    newSaveOrder.some((name) => {
      if (formatters.has(name)) {
        return false;
      }
      helpers.handleError(
        `'${name}' is not a valid formatter name.`,
        `Invalid format on save order`
      );
      return true;
    })
  ) {
    saveOrder = [];
  } else {
    saveOrder = newSaveOrder;
  }
  services.updateStatusBarTooltip();
}

function startFormatters(editor, formatterNames, buffer) {
  if (_.isEmpty(formatterNames)) {
    services.removeBusySignal(`Formatters on ${helpers.getEditorPath(editor)}`);
    return;
  }

  const name = formatterNames[0];
  services.addBusySignal(`${name} on ${helpers.getEditorPath(editor)}`);
  formatters.get(name).format(editor, buffer, () => {
    services.removeBusySignal(`${name} on ${helpers.getEditorPath(editor)}`);
    startFormatters(editor, formatterNames.slice(1), buffer);
  });
}

function format(editor, formatterNames, { buffer = true } = {}) {
  if (_.isEmpty(formatterNames)) {
    return;
  }

  services.addBusySignal(`Formatters on ${helpers.getEditorPath(editor)}`);
  startFormatters(editor, formatterNames, buffer);
}

function activate() {
  services.setStatusObject(status);
  config.formatters.forEach((name) => {
    formatters.set(name, new Formatter(name));
  });

  let activeGrammar = null;
  subscriptions.add(
    config.observe("formatOrder", (value) => {
      helpers.callWithTimeout(1000, "formatOrder", setFormatOrder, value);
    }),
    config.observe("onSave.saveOrder", (value) => {
      helpers.callWithTimeout(1000, "saveOrder", setSaveOrder, value);
    }),
    config.observe("busySignal", (value) => {
      services.consumeBusySignal(value ? busySignal : null);
    }),
    config.observe("statusBar", (value) => {
      services.consumeStatusBar(value ? statusBar : null);
    }),
    config.observe("onSave.enabled", (value) => {
      status.showTick = value;
      services.updateStatusBarElement();
    }),
    config.addCommand("toggle-format-on-save", () => {
      config.toggle("onSave.enabled");
    }),
    config.addCommand("format", () => {
      if (_.isEmpty(formatOrder)) {
        helpers.handleError(null, "Format order not defined");
      } else {
        format(atom.workspace.getActiveTextEditor(), formatOrder);
      }
    }),
    atom.workspace.observeTextEditors((editor) => {
      let subscription;
      subscriptions.add(
        editor.observeGrammar(() => {
          if (subscription) {
            subscription.dispose();
            subscription = null;
          }

          if (config.inScope(editor)) {
            subscription = editor.buffer.onDidSave(() => {
              if (config.get("onSave.enabled")) {
                if (_.isEmpty(saveOrder)) {
                  helpers.handleError(null, "Format on save order not defined");
                } else {
                  format(editor, saveOrder, { buffer: false });
                }
              }
            });
          }
        })
      );
    }),
    atom.workspace.observeActiveTextEditor((editor) => {
      if (activeGrammar) {
        activeGrammar.dispose();
        activeGrammar = null;
      }

      status.editor = editor;
      services.updateStatusBarTooltip();
      if (editor) {
        activeGrammar = editor.observeGrammar(() => {
          status.showTile = config.inScope(editor);
          services.updateStatusBarElement();
        });
      } else {
        status.showTile = false;
        services.updateStatusBarElement();
      }
    })
  );
}

function deactivate() {
  services.dispose();
  formatters.forEach((formatter) => {
    formatter.subscriptions.dispose();
  });
  subscriptions.dispose();
}

function consumeBusySignal(registry) {
  busySignal = registry.create();
  subscriptions.add(busySignal);
  if (config.get("busySignal")) {
    services.consumeBusySignal(busySignal);
  }
}

function consumeStatusBar(provider) {
  statusBar = provider;
  if (config.get("statusBar")) {
    services.consumeStatusBar(statusBar);
  }
}

module.exports = {
  config: config.schema,
  activate,
  deactivate,
  consumeBusySignal,
  consumeStatusBar,
};
