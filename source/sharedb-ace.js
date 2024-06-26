/**
 * @fileOverview
 * @name sharedb-ace.js
 * @author Jethro Kuan <jethrokuan95@gmail.com>
 * @license MIT
 */

import WebSocket from 'reconnecting-websocket';
import EventEmitter from 'event-emitter-es6';
import sharedb from 'sharedb/lib/client';
import SharedbAceBinding from './sharedb-ace-binding';

function IllegalArgumentException(message) {
  this.message = message;
  this.name = 'IllegalArgumentException';
}

class SharedbAce extends EventEmitter {
  /**
   * creating an instance connects to sharedb via websockets
   * and initializes the document with no connections
   *
   * Assumes that the document is already initialized
   *
   * The "ready" event is fired once the ShareDB document has been initialized
   *
   * @param {string} id - id of the ShareDB document
   * @param {Object} options - options object containing various
   * required configurations
   * @param {string} options.user.name - name of the associated user
   * @param {string} options.user.color - the hex color code associated to the
   * user's presence
   * @param {string} options.namespace - namespace of document within
   * ShareDB, to be equal to that on the server
   * @param {string} options.WsUrl - Websocket URL for ShareDB
   * @param {string} options.pluginWsUrl - Websocket URL for extra plugins
   * (different port from options.WsUrl)
   */
  constructor(id, options) {
    super();
    this.id = id;
    this.user = options.user;
    if (options.pluginWsUrl !== null) {
      this.pluginWS = new WebSocket(options.pluginWsUrl);
    }

    if (options.WsUrl === null) {
      throw new IllegalArgumentException('wsUrl not provided.');
    }

    this.WS = new WebSocket(options.WsUrl);

    const connection = new sharedb.Connection(this.WS);
    if (options.namespace === null) {
      throw new IllegalArgumentException('namespace not provided.');
    }
    const namespace = options.namespace;
    const doc = connection.get(namespace, id);

    // Fetches once from the server, and fires events
    // on subsequent document changes
    const docSubscribed = (err) => {
      if (err) throw err;

      if (!doc.type) {
        throw new Error(
          'ShareDB document uninitialized. Please check if you' +
            ' have the correct id or that you have initialized ' +
            'the document in the server.'
        );
      }

      this.emit('ready');
    };

    doc.subscribe(docSubscribed);

    // ShareDB presence to update cursor positions
    const usersPresence = connection.getPresence('users-' + id);
    usersPresence.subscribe();

    this.doc = doc;
    this.usersPresence = usersPresence;
    this.connections = {};

    this.WS.onopen(() => {
      for (const conn of this.connections) {
        conn.onRemoteReload();
      }
    })
  }

  /**
   * Creates a two-way binding between the ace instance and the document
   *
   * adds the binding to the instance's "connections" property
   *
   * @param {Object} ace - ace editor instance
   * @param {Object} cursorManager - cursor manager for the editor
   * @param {string[]} path - A lens, describing the nesting to the JSON document.
   * It should point to a string.
   * @param {Object[]} plugins - list of plugins to add to this particular
   * ace instance
   */
  add(ace, cursorManager, path, plugins) {
    const sharePath = path || [];
    const binding = new SharedbAceBinding({
      ace,
      doc: this.doc,
      user: this.user,
      cursorManager,
      usersPresence: this.usersPresence,
      path: sharePath,
      pluginWS: this.pluginWS,
      id: this.id,
      plugins,
      onError: (error) => this.emit('error', path, error)
    });
    this.connections[path.join('-')] = binding;
  }
}

export default SharedbAce;
