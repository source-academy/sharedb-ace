/**
 * @fileOverview
 * @name sharedb-ace-binding.js
 * @author Jethro Kuan <jethrokuan95@gmail.com>
 * @license MIT
 */

// TODO: support reconnects with same id

// TODO: We keep getting:
// connection to 'ws...' failed: Invalid frame header

import WebSocket from 'reconnecting-websocket';
import Logdown from 'logdown';
import sharedb from 'sharedb/lib/sharedb';
import type {
  AceMultiCursorManager,
  AceMultiSelectionManager,
  AceRadarView,
  IRangeData
} from '@convergencelabs/ace-collab-ext';
import { IIndexRange } from '@convergencelabs/ace-collab-ext/dist/types/IndexRange';
import { AceViewportUtil, AceRangeUtil } from '@convergencelabs/ace-collab-ext';
import type { Ace, EditSession } from 'ace-builds';
import type { IAceEditor } from 'react-ace/lib/types';
import type { SharedbAcePlugin, SharedbAceUser } from './types';

function traverse(object: any, path: string[]) {
  for (const key of path) {
    object = object[key];
  }
  return object;
}

interface SharedbAceBindingOptions {
  ace: IAceEditor;
  doc: sharedb.Doc;
  user: SharedbAceUser;
  cursorManager: AceMultiCursorManager;
  selectionManager: AceMultiSelectionManager;
  radarManager: AceRadarView;
  usersPresence: sharedb.Presence;
  pluginWS?: WebSocket;
  path: string[];
  plugins?: SharedbAcePlugin[];
  onError: (err: unknown) => unknown;
}

interface PresenceUpdate {
  user: SharedbAceUser;
  cursorPos?: Ace.Point;
  selectionRange?: IRangeData[];
  radarViewRows?: IIndexRange;
  radarCursorRow?: number;
}

class SharedbAceBinding {
  editor: IAceEditor;
  session: EditSession;

  user: SharedbAceUser;
  doc: sharedb.Doc;

  path: string[];

  cursorManager: AceMultiCursorManager;
  selectionManager: AceMultiSelectionManager;
  radarManager: AceRadarView;

  usersPresence: sharedb.Presence;

  logger: Logdown.Logger;

  // When ops are applied to sharedb, ace emits edit events.
  // This events need to be suppressed to prevent infinite looping
  suppress = false;

  localPresence?: sharedb.LocalPresence<PresenceUpdate>;

  onError: (err: unknown) => unknown;

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
  constructor(options: SharedbAceBindingOptions) {
    this.editor = options.ace;
    this.session = this.editor.getSession();
    this.path = options.path;
    this.doc = options.doc;
    this.user = options.user;
    this.cursorManager = options.cursorManager;
    this.selectionManager = options.selectionManager;
    this.radarManager = options.radarManager;
    this.usersPresence = options.usersPresence;
    this.onError = options.onError;
    this.logger = Logdown('shareace');

    // Initialize plugins
    if (options.pluginWS && options.plugins) {
      const { pluginWS } = options;
      options.plugins.forEach((plugin) => plugin(pluginWS, this.editor));
    }

    // Set value of ace document to ShareDB document value
    this.setInitialValue();

    // Listen to edit changes and cursor position changes
    this.listen();
  }

  /**
   * Sets the ace document value to the ShareDB document value
   */
  setInitialValue = () => {
    this.suppress = true;
    this.session.setValue(traverse(this.doc.data, this.path));
    this.suppress = false;

    this.cursorManager.removeAll();
    this.selectionManager.removeAll();
    // TODO: Remove all views for radarManager
    // this.radarManager.removeView();
    this.initializeLocalPresence();
    for (const [id, update] of Object.entries(this.usersPresence.remotePresences)) {
      this.initializeRemotePresence(id, update);
    }
  };

  /**
   * Listens to the changes
   */
  listen = () => {
    // TODO: Also update view on window resize
    this.session.on('change', this.onLocalChange);
    this.session.on('changeScrollTop', this.onLocalChangeScrollTop);
    this.doc.on('op', this.onRemoteChange);
    this.doc.on('load', this.onRemoteReload);

    this.usersPresence.on('receive', this.onPresenceUpdate);
    this.session.selection.on('changeCursor', this.onLocalCursorChange);
    this.session.selection.on('changeSelection', this.onLocalSelectionChange);
  };

  /**
   * Stop listening to changes
   */
  unlisten = () => {
    this.session.removeListener('change', this.onLocalChange);
    this.session.off('changeScrollTop', this.onLocalChangeScrollTop);
    this.doc.off('op', this.onRemoteChange);
    this.doc.off('load', this.onRemoteReload);

    this.usersPresence.off('receive', this.onPresenceUpdate);
    this.session.selection.off('changeCursor', this.onLocalCursorChange);
    this.session.selection.off('changeSelection', this.onLocalSelectionChange);
  };

  /**
   * Delta (Ace Editor) -> Op (ShareDB)
   *
   * @param {Object} delta - delta created by ace editor
   * @returns {Object}  op - op compliant with ShareDB
   * @throws {Error} throws error if delta is malformed
   */
  deltaTransform = (delta: Ace.Delta): sharedb.Op => {
    // TODO: Use SubtypeOp to declare new operations
    const aceDoc = this.session.getDocument();
    const start = aceDoc.positionToIndex(delta.start);
    const end = aceDoc.positionToIndex(delta.end);
    let op: sharedb.Op;
    this.logger.log(`start: ${start} end: ${end}`);
    const str = delta.lines.join('\n');
    if (delta.action === 'insert') {
      op = {
        p: [...this.path, start],
        si: str
      };
    } else if (delta.action === 'remove') {
      op = {
        p: [...this.path, start],
        sd: str
      };
    } else {
      throw new Error(`action ${delta.action} not supported`);
    }

    return op;
  };

  /**
   *
   * @param {Object[]} ops - array of ShareDB ops
   * @returns {Object[]} deltas - array of Ace Editor compliant deltas
   * @throws {Error} throws error on malformed op
   */
  opTransform = (ops: sharedb.Op[]): Ace.Delta[] => {
    const self = this;
    const opToDelta = (op: sharedb.Op): Ace.Delta => {
      const index = op.p.at(-1) as number;
      const pos = self.session.doc.indexToPosition(index, 0);
      const start = pos;
      let action: 'remove' | 'insert';
      let lines: string[];
      let end: Ace.Point;

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

      return {
        start,
        end,
        action,
        lines
      };
    };
    return ops.map(opToDelta);
  };

  /**
   * Event listener for local changes (ace editor)
   *
   * transforms delta into ShareDB op and sends it to the server.
   *
   * @param {} delta - ace editor op (compliant with
   * ace editor event listener spec)
   */
  onLocalChange = (delta: Ace.Delta) => {
    try {
      this.logger.log(`*local*: fired ${Date.now()}`);
      this.logger.log(`*local*: delta received: ${JSON.stringify(delta)}`);

      if (this.suppress) {
        this.logger.log('*local*: local delta, _skipping_');
        return;
      }
      const op = this.deltaTransform(delta);
      this.logger.log(`*local*: transformed op: ${JSON.stringify(op)}`);

      const docSubmitted: sharedb.Callback = (err) => {
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
  };

  /**
   * Event Listener for remote events (ShareDB)
   *
   * @param {Object[]} ops - array of ShareDB ops
   * @param {Object} source - which sharedb-ace-binding instance
   * created the op. If self, don't apply the op.
   */
  onRemoteChange = (ops: sharedb.Op[], source: this | false, clientId?: string) => {
    try {
      this.logger.log(`*remote*: fired ${Date.now()}`);

      const opsPath = ops[0].p.slice(0, ops[0].p.length - 1).toString();
      this.logger.log(opsPath);
      if (source === this) {
        this.logger.log('*remote*: op origin is self; _skipping_');
        return;
      } else if (opsPath !== this.path.toString()) {
        this.logger.log('*remote*: not from my path; _skipping_');
        return;
      }

      const deltas = this.opTransform(ops);
      this.logger.log(`*remote*: op received: ${JSON.stringify(ops)}`);
      this.logger.log(`*remote*: transformed delta: ${JSON.stringify(deltas)}`);

      this.suppress = true;
      this.session.getDocument().applyDeltas(deltas);
      this.suppress = false;

      this.logger.log('*remote*: session value');
      this.logger.log(JSON.stringify(this.session.getValue()));
      this.logger.log('*remote*: delta applied');
    } catch (err) {
      this.onError && this.onError(err);
    }
  };

  onPresenceUpdate = (id: string, update: PresenceUpdate) => {
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

      try {
        this.radarManager.removeView(id);
        // eslint-disable-next-line no-empty
      } catch {}

      return;
    }

    if (update.cursorPos) {
      try {
        this.cursorManager.setCursor(id, update.cursorPos);
      } catch {
        this.cursorManager.addCursor(id, update.user.name, update.user.color, update.cursorPos);
      }
    }

    if (update.selectionRange) {
      const ranges = AceRangeUtil.fromJson(update.selectionRange);
      try {
        this.selectionManager.setSelection(id, ranges);
      } catch {
        this.selectionManager.addSelection(id, update.user.name, update.user.color, ranges);
      }
    }

    if (update.radarViewRows) {
      const intialRows = AceViewportUtil.indicesToRows(
        this.editor,
        update.radarViewRows.start,
        update.radarViewRows.end
      );
      try {
        this.radarManager.setViewRows(id, intialRows);
      } catch {
        this.radarManager.addView(
          id,
          update.user.name,
          update.user.color,
          intialRows,
          update.radarCursorRow || 0
        );
      }
    }
  };

  onLocalChangeScrollTop = (scrollTop: number) => {
    // TODO: logger and error handling
    const viewportIndices = AceViewportUtil.getVisibleIndexRange(this.editor);
    this.localPresence?.submit({
      user: this.user,
      radarViewRows: viewportIndices
    });
  };

  onLocalCursorChange = () => {
    // TODO: logger and error handling
    const pos = this.session.selection.getCursor();
    this.localPresence?.submit({
      user: this.user,
      cursorPos: pos,
      radarCursorRow: pos.row
    });
  };

  onLocalSelectionChange = () => {
    // TODO: logger and error handling
    const ranges = this.session.selection.getAllRanges();
    this.localPresence?.submit({
      user: this.user,
      selectionRange: AceRangeUtil.toJson(ranges)
    });
  };

  initializeLocalPresence = () => {
    // TODO: logger and error handling
    this.localPresence = this.usersPresence.create();
    const cursorPos = this.session.selection.getCursor();
    const ranges = this.session.selection.getAllRanges();

    const initialIndices = AceViewportUtil.getVisibleIndexRange(this.editor);

    this.localPresence.submit({
      user: this.user,
      cursorPos,
      selectionRange: ranges,
      radarViewRows: initialIndices,
      radarCursorRow: cursorPos.row
    });
  };

  // TODO: Actually the same as onPresenceUpdate
  initializeRemotePresence = (id: string, update: PresenceUpdate) => {
    if (update.cursorPos) {
      try {
        this.cursorManager.setCursor(id, update.cursorPos);
      } catch {
        this.cursorManager.addCursor(id, update.user.name, update.user.color, update.cursorPos);
      }
    }

    if (update.selectionRange) {
      const ranges = AceRangeUtil.fromJson(update.selectionRange);
      try {
        this.selectionManager.setSelection(id, ranges);
      } catch {
        this.selectionManager.addSelection(id, update.user.name, update.user.color, ranges);
      }
    }

    if (update.radarViewRows) {
      const rows = AceViewportUtil.indicesToRows(
        this.editor,
        update.radarViewRows.start,
        update.radarViewRows.end
      );

      try {
        this.radarManager.setViewRows(id, rows);
        this.radarManager.setCursorRow(id, update.radarCursorRow || 0);
      } catch {
        this.radarManager.addView(
          id,
          update.user.name,
          update.user.color,
          rows,
          update.radarCursorRow || 0
        );
      }
    }
  };

  destroyPresence = () => {
    // TODO: logger and error handling
    this.localPresence?.destroy();
    this.localPresence = undefined;
  };

  /**
   * Handles document load event. Called when there is a transform error and
   * ShareDB reloads the document, or when websocket has to reconnect.
   */
  onRemoteReload = () => {
    this.logger.log('*remote*: reloading document');
    this.setInitialValue();
  };
}

export default SharedbAceBinding;
