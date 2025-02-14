/**
 * @fileOverview
 * @name sharedb-ace-binding.js
 * @author Jethro Kuan <jethrokuan95@gmail.com>
 * @license MIT
 */

import Logdown from 'logdown';
import { AceRangeUtil } from '@convergencelabs/ace-collab-ext';

function traverse(object, path) {
  for (const key of path) {
    object = object[key];
  }
  return object;
}

class SharedbAceBinding {
  /**
   * Constructs the binding object.
   *
   * Initializes the Ace document initial value to that of the
   * ShareDB document. Also , sets up the local and remote event
   * listeners, and begins listening to local and remote change events
   *
   * @param {Object} options - contains all parameters
   * @param {Object} options.ace - ace editor instance
   * @param {Object} options.doc - ShareDB document
   * @param {Object} options.user - information regarding the user
   * @param {Object} options.cursorManager - the instance managing
   * the cursors in the editor
   * @param {Object} options.selectionManager - the instance managing
   * the selections in the editor
   * @param {Object} options.usersPresence - ShareDB presence channel
   * containing information of the users, including cursor positions
   * @param {Object} options.pluginWS - WebSocket connection for
   * sharedb-ace plugins
   * @param {string[]} options.path - A lens, describing the nesting
   * to the JSON document. It should point to a string.
   * @param {Object[]} options.plugins - array of sharedb-ace plugins
   * @param {?function} options.onError - a callback on error
   * @example
   * const binding = new SharedbAceBinding({
   *   ace: aceInstance,
   *   doc: sharedbDoc,
   *   user: { name: "User", color: "#ffffff" }
   *   cursorManager: cursorManager,
   *   selectionManager: selectionManager,
   *   usersPresence: usersPresence,
   *   path: ["path"],
   *   plugins: [ SharedbAceMultipleCursors ],
   *   pluginWS: "http://localhost:3108/ws",
   * })
   */
  constructor(options) {
    this.editor = options.ace;
    this.editor.id = `${options.id}-${options.path}`;
    this.editor.$blockScrolling = Infinity;
    this.session = this.editor.getSession();
    this.newline = this.session.getDocument().getNewLineCharacter();
    this.path = options.path;
    this.doc = options.doc;
    this.user = options.user;
    this.cursorManager = options.cursorManager;
    this.selectionManager = options.selectionManager;
    this.usersPresence = options.usersPresence;
    this.pluginWS = options.pluginWS;
    this.plugins = options.plugins || [];
    this.onError = options.onError;
    this.logger = new Logdown('shareace');

    // Initialize plugins
    this.plugins.forEach((plugin) => {
      plugin(this.pluginWS, this.editor);
    });

    // When ops are applied to sharedb, ace emits edit events.
    // This events need to be suppressed to prevent infinite looping
    this.suppress = false;

    // Event Listeners
    this.$onLocalChange = this.onLocalChange.bind(this);
    this.$onRemoteChange = this.onRemoteChange.bind(this);

    this.$onRemotePresenceUpdate = this.onRemotePresenceUpdate.bind(this);
    this.$onLocalCursorChange = this.onLocalCursorChange.bind(this);
    this.$onLocalSelectionChange = this.onLocalSelectionChange.bind(this);

    this.$initializePresence = this.initializePresence.bind(this);
    this.$initializeRemotePresence = this.initializeRemotePresence.bind(this);

    this.$updateCursorPresence = this.updateCursorPresence.bind(this);
    this.$updateSelectionPresence = this.updateSelectionPresence.bind(this);
    this.$destroyPresence = this.destroyPresence.bind(this);

    this.$onRemoteReload = this.onRemoteReload.bind(this);

    // Set value of ace document to ShareDB document value
    this.setInitialValue();

    // Listen to edit changes and cursor position changes
    this.listen();
  }

  /**
   * Sets the ace document value to the ShareDB document value
   */
  setInitialValue() {
    this.suppress = true;
    this.session.setValue(traverse(this.doc.data, this.path));
    this.suppress = false;

    this.cursorManager.removeAll();
    this.selectionManager.removeAll();
    this.$initializePresence();
    for (const [id, update] of Object.entries(this.usersPresence.remotePresences)) {
      this.initializeRemotePresence(id, update);
    }
  }

  /**
   * Listens to the changes
   */
  listen() {
    this.session.on('change', this.$onLocalChange);
    this.doc.on('op', this.$onRemoteChange);
    this.doc.on('load', this.$onRemoteReload);

    this.usersPresence.on('receive', this.$onRemotePresenceUpdate);
    this.session.selection.on('changeCursor', this.$onLocalCursorChange);
    this.session.selection.on('changeSelection', this.$onLocalSelectionChange);
  }

  /**
   * Stop listening to changes
   */
  unlisten() {
    this.session.removeListener('change', this.$onLocalChange);
    this.doc.off('op', this.$onRemoteChange);
    this.doc.off('load', this.$onRemoteReload);

    this.usersPresence.off('receive', this.$onRemotePresenceUpdate);
    this.session.selection.off('changeCursor', this.$onLocalCursorChange);
    this.session.selection.off('changeSelection', this.$onLocalSelectionChange);
  }

  /**
   * Delta (Ace Editor) -> Op (ShareDB)
   *
   * @param {Object} delta - delta created by ace editor
   * @returns {Object}  op - op compliant with ShareDB
   * @throws {Error} throws error if delta is malformed
   */
  deltaTransform(delta) {
    const aceDoc = this.session.getDocument();
    const op = {};
    const start = aceDoc.positionToIndex(delta.start);
    const end = aceDoc.positionToIndex(delta.end);
    op.p = this.path.concat(start);
    this.logger.log(`start: ${start} end: ${end}`);
    let action;
    if (delta.action === 'insert') {
      action = 'si';
    } else if (delta.action === 'remove') {
      action = 'sd';
    } else {
      throw new Error(`action ${action} not supported`);
    }

    const str = delta.lines.join('\n');

    op[action] = str;
    return op;
  }

  /**
   *
   * @param {Object[]} ops - array of ShareDB ops
   * @returns {Object[]} deltas - array of Ace Editor compliant deltas
   * @throws {Error} throws error on malformed op
   */
  opTransform(ops) {
    const self = this;
    function opToDelta(op) {
      const index = op.p[op.p.length - 1];
      const pos = self.session.doc.indexToPosition(index, 0);
      const start = pos;
      let action;
      let lines;
      let end;

      if ('sd' in op) {
        action = 'remove';
        lines = op.sd.split('\n');
        const count = lines.reduce((total, line) => total + line.length, lines.length - 1);
        end = self.session.doc.indexToPosition(index + count, 0);
      } else if ('si' in op) {
        action = 'insert';
        lines = op.si.split('\n');
        if (lines.length === 1) {
          end = {
            row: start.row,
            column: start.column + op.si.length
          };
        } else {
          end = {
            row: start.row + (lines.length - 1),
            column: lines[lines.length - 1].length
          };
        }
      } else {
        throw new Error(`Invalid Operation: ${JSON.stringify(op)}`);
      }

      const delta = {
        start,
        end,
        action,
        lines
      };

      return delta;
    }
    const deltas = ops.map(opToDelta);
    return deltas;
  }

  /**
   * Event listener for local changes (ace editor)
   *
   * transforms delta into ShareDB op and sends it to the server.
   *
   * @param {} delta - ace editor op (compliant with
   * ace editor event listener spec)
   */
  onLocalChange(delta) {
    try {
      this.logger.log(`*local*: fired ${Date.now()}`);
      this.logger.log(`*local*: delta received: ${JSON.stringify(delta)}`);

      if (this.suppress) {
        this.logger.log('*local*: local delta, _skipping_');
        return;
      }
      const op = this.deltaTransform(delta);
      this.logger.log(`*local*: transformed op: ${JSON.stringify(op)}`);

      const docSubmitted = (err) => {
        if (err) {
          this.onError && this.onError(err);
          this.logger.log(`*local*: op error: ${err}`);
        } else {
          this.logger.log('*local*: op submitted');
        }
      };

      if (!this.doc.type) {
        // likely previous operation failed, we're out of sync
        // don't submitOp now
        return;
      }

      this.doc.submitOp(op, { source: this }, docSubmitted);
    } catch (err) {
      this.onError && this.onError(err);
    }
  }

  /**
   * Event Listener for remote events (ShareDB)
   *
   * @param {Object[]} ops - array of ShareDB ops
   * @param {Object} source - which sharedb-ace-binding instance
   * created the op. If self, don't apply the op.
   */
  onRemoteChange(ops, source) {
    try {
      this.logger.log(`*remote*: fired ${Date.now()}`);
      const self = this;

      const opsPath = ops[0].p.slice(0, ops[0].p.length - 1).toString();
      this.logger.log(opsPath);
      if (source === self) {
        this.logger.log('*remote*: op origin is self; _skipping_');
        return;
      } else if (opsPath !== this.path.toString()) {
        this.logger.log('*remote*: not from my path; _skipping_');
        return;
      }

      const deltas = this.opTransform(ops);
      this.logger.log(`*remote*: op received: ${JSON.stringify(ops)}`);
      this.logger.log(`*remote*: transformed delta: ${JSON.stringify(deltas)}`);

      self.suppress = true;
      self.session.getDocument().applyDeltas(deltas);
      self.suppress = false;

      this.logger.log('*remote*: session value');
      this.logger.log(JSON.stringify(this.session.getValue()));
      this.logger.log('*remote*: delta applied');
    } catch (err) {
      this.onError && this.onError(err);
    }
  }

  onRemotePresenceUpdate(id, update) {
    // TODO: logger and error handling
    // TODO: separate into multiple handlers
    if (update === null) {
      try {
        this.cursorManager.removeCursor(id);
        // eslint-disable-next-line no-empty
      } catch {}

      try {
        this.selectionManager.removeSelection(id);
        // eslint-disable-next-line no-empty
      } catch {}
    } else {
      if (update.cursorPos) {
        try {
          this.cursorManager.setCursor(id, update.cursorPos);
        } catch {
          this.cursorManager.addCursor(id, update.user.name, update.user.color, update.cursorPos);
        }
      }

      if (update.ranges) {
        const ranges = AceRangeUtil.fromJson(update.ranges);
        try {
          this.selectionManager.setSelection(id, ranges);
        } catch {
          this.selectionManager.addSelection(id, update.user.name, update.user.color, ranges);
        }
      }
    }
  }

  onLocalCursorChange() {
    const pos = this.session.selection.getCursor();
    this.updateCursorPresence(pos);
  }

  onLocalSelectionChange() {
    const ranges = this.session.selection.getAllRanges();
    this.updateSelectionPresence(AceRangeUtil.toJson(ranges));
  }

  initializePresence() {
    // TODO: logger and error handling
    this.localPresence = this.usersPresence.create();
    const cursorPos = this.session.selection.getCursor();
    const ranges = this.session.selection.getAllRanges();
    this.localPresence.submit({
      user: this.user,
      cursorPos,
      ranges
    });
  }

  initializeRemotePresence(id, update) {
    try {
      this.cursorManager.setCursor(id, update.cursorPos);
    } catch {
      this.cursorManager.addCursor(id, update.user.name, update.user.color, update.cursorPos);
    }

    try {
      this.selectionManager.setSelection(id, update.ranges);
    } catch {
      this.selectionManager.addSelection(id, update.user.name, update.user.color, update.ranges);
    }
  }

  updateCursorPresence(newCursorPos) {
    // TODO: logger and error handling
    this.localPresence.submit({
      user: this.user,
      cursorPos: newCursorPos
    });
  }

  updateSelectionPresence(newRanges) {
    // TODO: logger and error handling
    this.localPresence.submit({
      user: this.user,
      ranges: newRanges
    });
  }

  destroyPresence() {
    // TODO: logger and error handling
    this.localPresence.destroy();
    this.localPresence = undefined;
  }

  /**
   * Handles document load event. Called when there is a transform error and
   * ShareDB reloads the document, or when websocket has to reconnect.
   */
  onRemoteReload() {
    this.logger.log('*remote*: reloading document');
    this.setInitialValue();
  }
}

export default SharedbAceBinding;
