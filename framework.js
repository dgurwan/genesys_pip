// framework.js — le seul fichier qui NE fait PAS partie de l'extension.
//
// Il s'uploade dans l'integration privee Genesys Cloud (gdp_private_gc_ef) et
// tourne a l'interieur de l'iframe Genesys. C'est donc le seul endroit qui
// accede a window.PureCloud et aux API Platform de Genesys Cloud.
//
// Il communique avec l'extension par postMessage:
//
//   Recoit (depuis src/genesysBridge.js)      Envoie (vers src/app.js)
//   ------------------------------------      ---------------------------------
//   genesys:ping                              genesys:framework:ready
//   genesys:presence:getDefinitions           genesys:presence:definitions
//   genesys:notifications:setup               genesys:conversation:notification
//   genesys:user:updateStatus                 genesys:user:presence
//   genesys:user:makeEligibleForInteractions  genesys:routing:notification
//   genesys:interaction:updateState           genesys:wrapup:codes
//   genesys:wrapup:getCodes                   screenPop / interactionSubscription
//   genesys:wrapup:submit                     ... et leurs variantes :error
//
// Ecrit en ES5 (var, pas de fleches) car il est charge par Genesys Cloud.

var presenceDefinitionsInFlight = false;
var presenceDefinitionsCache = null;
var notificationSocket = null;
var notificationSetupInFlight = false;
var notificationSetupDone = false;
var notificationReconnectTimer = null;
var notificationUserId = null;
var routingStatusPollTimer = null;
var lastRoutingStatusSent = null;

var ALLOWED_PRIMARY_PRESENCES = [
  'AVAILABLE',
  'AWAY',
  'BREAK',
  'BUSY',
  'MEAL',
  'TRAINING'
];

window.Framework = {
  config: {
    name: 'gdp_private_gc_ef',

    clientIds: {
      'mypurecloud.com': '',
      'mypurecloud.ie': '6ea8695a-b827-4887-8899-59af3bf73ffc',
      'mypurecloud.de': '',
      'mypurecloud.com.au': '',
      'mypurecloud.jp': '',
      'cac1.pure.cloud': '',
      'euw2.pure.cloud': '',
      'apne2.pure.cloud': ''
    },

    settings: {
      dedicatedLoginWindow: true,
      embedWebRTCByDefault: true,
      hideWebRTCPopUpOption: false,
      enableCallLogs: true,
      enableTransferContext: true,
      searchTargets: ['people', 'queues']
    }
  },

  initialSetup: function () {
    sendFrameworkReady();

    window.PureCloud.subscribe([
      {
        type: 'Interaction',
        callback: function (category, interaction) {
          sendToParent({
            type: 'interactionSubscription',
            data: { category: category, interaction: interaction }
          });
        }
      },
      {
        type: 'UserAction',
        callback: function (category, data) {
          sendToParent({
            type: 'userActionSubscription',
            data: { category: category, data: data }
          });
        }
      },
      {
        type: 'Notification',
        callback: function (category, data) {
          sendToParent({
            type: 'notificationSubscription',
            data: { category: category, data: data }
          });
        }
      }
    ]);

    window.addEventListener('message', function (event) {
      var message;

      try {
        message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch (e) {
        return;
      }

      if (!message || !message.type) return;

      if (message.type === 'genesys:ping') {
        sendFrameworkReady();
        setupConversationNotifications();
        return;
      }

      if (message.type === 'genesys:presence:getDefinitions') {
        // Le polling n'emet que sur changement: on le force a re-emettre pour
        // que la PiP recoive l'etat courant a son ouverture.
        lastRoutingStatusSent = null;
        getPresenceDefinitions();
        setupConversationNotifications();
        return;
      }

      if (message.type === 'genesys:notifications:setup') {
        setupConversationNotifications();
        return;
      }

      if (message.type === 'genesys:interaction:updateState') {
        updateInteractionState(message.data);
        return;
      }

      if (message.type === 'genesys:user:updateStatus') {
        updateUserPresence(message.data);
        return;
      }

      if (message.type === 'genesys:user:makeEligibleForInteractions') {
        makeEligibleForInteractions();
        return;
      }

      if (message.type === 'genesys:wrapup:getCodes') {
        getWrapupCodes(message.data || {});
        return;
      }

      if (message.type === 'genesys:wrapup:submit') {
        submitWrapup(message.data || {});
        return;
      }
    });

    setTimeout(function () {
      getPresenceDefinitions();
      setupConversationNotifications();
    }, 1000);
  },

  // Appele par Genesys quand une interaction arrive: on relaie l'evenement a
  // l'extension pour afficher l'appel et ses participant data dans la PiP.
  screenPop: function (searchString, interaction) {
    sendToParent({
      type: 'screenPop',
      data: {
        source: 'screenPop',
        searchString: searchString,
        interaction: interaction,
        receivedAt: new Date().toISOString()
      }
    });
  }
};

function sendFrameworkReady() {
  sendToParent({
    type: 'genesys:framework:ready',
    data: { ready: true }
  });
}

function updateInteractionState(data) {
  if (!data || !data.id || !data.action) return;

  window.PureCloud.Interaction.updateState({
    id: data.id,
    action: data.action
  });
}

function updateUserPresence(data) {
  if (!data || !data.id) return;
  window.PureCloud.User.updateStatus({ id: data.id });
}

function getPresenceDefinitions() {
  if (presenceDefinitionsCache) {
    sendToParent({ type: 'genesys:presence:definitions', data: presenceDefinitionsCache });
    refreshCurrentUserPresence();
    return;
  }

  if (presenceDefinitionsInFlight) return;
  presenceDefinitionsInFlight = true;

  withAuthToken(function (token, apiHost) {
    sendToParent({ type: 'genesys:presence:loading', data: { apiHost: apiHost } });

    Promise.all([
      genesysApiGet(apiHost + '/api/v2/systempresences', token),
      getAllPresenceDefinitions(apiHost, token)
    ])
      .then(function (results) {
        presenceDefinitionsInFlight = false;
        var systemPresences = normalizeSystemPresences(results[0]);
        var definitions = Array.isArray(results[1]) ? results[1] : [];
        var activeDefinitions = definitions.filter(function (presence) {
          return presence && presence.id && presence.systemPresence && !presence.deactivated;
        });

        presenceDefinitionsCache = {
          groupedStatuses: buildGroupedPresenceStatuses(systemPresences, activeDefinitions),
          queuePresence: buildQueuePresence(systemPresences, activeDefinitions)
        };

        sendToParent({ type: 'genesys:presence:definitions', data: presenceDefinitionsCache });
        refreshCurrentUserPresence();
      })
      .catch(function (error) {
        presenceDefinitionsInFlight = false;
        sendToParent({
          type: 'genesys:presence:definitions:error',
          data: { message: error.message || String(error) }
        });
      });
  }, function (message) {
    presenceDefinitionsInFlight = false;
    sendToParent({ type: 'genesys:presence:definitions:error', data: { message: message } });
  });
}

function refreshCurrentUserPresence() {
  withAuthToken(function (token, apiHost) {
    genesysApiGet(apiHost + '/api/v2/users/me?expand=presence', token)
      .then(function (user) {
        if (!user || !user.presence) return;
        sendToParent({ type: 'genesys:user:presence', data: { presence: user.presence } });
      })
      .catch(function () {
        // Best effort: si la presence ne se recharge pas, ce n'est pas bloquant.
      });
  });
}

function setupConversationNotifications() {
  if (notificationSetupDone || notificationSetupInFlight) return;

  notificationSetupInFlight = true;

  withAuthToken(function (token, apiHost) {
    genesysApiGet(apiHost + '/api/v2/users/me', token)
      .then(function (user) {
        if (!user || !user.id) throw new Error('Impossible de recuperer users/me pour les notifications.');

        notificationUserId = user.id;
        return createNotificationChannel(apiHost, token)
          .then(function (channel) {
            if (!channel || !channel.id || !channel.connectUri) throw new Error('Canal notifications incomplet.');

            return subscribeToNotificationTopics(apiHost, token, channel.id, user.id)
              .then(function () {
                openNotificationSocket(channel.connectUri);
                startRoutingStatusPoll(apiHost, token, user.id);
                notificationSetupDone = true;
                notificationSetupInFlight = false;
                sendToParent({
                  type: 'genesys:conversation:notification:ready',
                  data: { channelId: channel.id, userId: user.id }
                });
              });
          });
      })
      .catch(function (error) {
        notificationSetupDone = false;
        notificationSetupInFlight = false;
        sendToParent({
          type: 'genesys:conversation:notification:error',
          data: { message: error.message || String(error) }
        });
      });
  }, function (message) {
    notificationSetupInFlight = false;
    sendToParent({ type: 'genesys:conversation:notification:error', data: { message: message } });
  });
}

function createNotificationChannel(apiHost, token) {
  return genesysApiFetch(apiHost + '/api/v2/notifications/channels', token, {
    method: 'POST',
    body: {}
  });
}

function subscribeToNotificationTopics(apiHost, token, channelId, userId) {
  var topics = [
    'v2.users.' + userId + '.conversations.calls',
    'v2.users.' + userId + '.routingStatus'
  ];

  return genesysApiFetch(apiHost + '/api/v2/notifications/channels/' + encodeURIComponent(channelId) + '/subscriptions', token, {
    method: 'PUT',
    body: topics.map(function (topic) { return { id: topic }; })
  });
}

function openNotificationSocket(connectUri) {
  if (notificationSocket) {
    try { notificationSocket.close(); } catch (e) {}
    notificationSocket = null;
  }

  notificationSocket = new WebSocket(connectUri);

  notificationSocket.onmessage = function (messageEvent) {
    var notification;
    try { notification = JSON.parse(messageEvent.data); } catch (e) { return; }
    if (!notification || !notification.topicName || !notification.eventBody) return;

    var topicKey = normalizePresenceKey(notification.topicName);
    if (topicKey.includes('routingstatus')) {
      sendToParent({
        type: 'genesys:routing:notification',
        data: {
          topicName: notification.topicName,
          routingStatus: notification.eventBody,
          receivedAt: new Date().toISOString()
        }
      });
      return;
    }

    sendToParent({
      type: 'genesys:conversation:notification',
      data: {
        topicName: notification.topicName,
        conversation: notification.eventBody,
        receivedAt: new Date().toISOString()
      }
    });
  };

  notificationSocket.onerror = function () {
    sendToParent({ type: 'genesys:conversation:notification:error', data: { message: 'Erreur WebSocket notifications Genesys.' } });
  };

  notificationSocket.onclose = function () {
    notificationSocket = null;
    notificationSetupDone = false;
    clearTimeout(notificationReconnectTimer);
    notificationReconnectTimer = setTimeout(setupConversationNotifications, 5000);
  };
}

function startRoutingStatusPoll(apiHost, token, userId) {
  clearInterval(routingStatusPollTimer);

  function poll() {
    genesysApiGet(apiHost + '/api/v2/users/' + encodeURIComponent(userId) + '/routingstatus', token)
      .then(function (status) {
        var statusKey = normalizePresenceKey(status && (status.routingStatus || status.status || status.name || status.state));
        if (!statusKey || statusKey === lastRoutingStatusSent) return;
        lastRoutingStatusSent = statusKey;
        sendToParent({
          type: 'genesys:routing:notification',
          data: {
            topicName: 'poll:/api/v2/users/{userId}/routingstatus',
            routingStatus: status,
            receivedAt: new Date().toISOString()
          }
        });
      })
      .catch(function () {
        // Le polling n'est qu'un filet de secours du WebSocket.
      });
  }

  poll();
  routingStatusPollTimer = setInterval(poll, 3000);
}

function makeEligibleForInteractions() {
  withAuthToken(function (token, apiHost) {
    ensureNotificationUserId(token, apiHost)
      .then(function (userId) {
        return genesysApiGet(apiHost + '/api/v2/users/' + encodeURIComponent(userId) + '/routingstatus', token)
          .then(function (currentStatus) {
            var key = normalizePresenceKey(currentStatus && (currentStatus.routingStatus || currentStatus.status || currentStatus.name || currentStatus.state));

            // Genesys n'autorise un changement manuel de routing status que vers
            // IDLE, et seulement depuis NOT_RESPONDING. Si l'agent n'est plus dans
            // cet etat, on repond succes plutot que d'envoyer une requete qui
            // renverrait HTTP 400.
            if (key && !key.includes('notresponding')) {
              sendToParent({
                type: 'genesys:routing:update:success',
                data: { routingStatus: currentStatus, alreadyEligible: true }
              });
              return null;
            }

            return genesysApiFetch(apiHost + '/api/v2/users/' + encodeURIComponent(userId) + '/routingstatus', token, {
              method: 'PUT',
              body: { status: 'IDLE' }
            }).then(function (response) {
              sendToParent({
                type: 'genesys:routing:update:success',
                data: { routingStatus: 'IDLE', response: response || null }
              });
            });
          });
      })
      .catch(function (error) {
        sendToParent({
          type: 'genesys:routing:update:error',
          data: { message: error.message || String(error) }
        });
      });
  }, function (message) {
    sendToParent({ type: 'genesys:routing:update:error', data: { message: message } });
  });
}

// Les codes wrap-up appartiennent a la file sur laquelle la conversation est
// arrivee. La seule difficulte est de connaitre cette file de facon fiable:
//  1. le queueId deduit de la notification, s'il est present ;
//  2. sinon on relit la conversation via l'API, qui est la source de verite ;
//  3. en dernier recours seulement, les codes du participant (cas sans file:
//     appel sortant, appel direct, transfert a froid).
function getWrapupCodes(data) {
  var conversationId = data && data.conversationId;
  var participantId = data && data.participantId;
  var knownQueueId = data && data.queueId;

  if (!conversationId && !knownQueueId) {
    sendToParent({
      type: 'genesys:wrapup:codes:error',
      data: { message: 'Conversation inconnue: impossible de determiner la file.' }
    });
    return;
  }

  withAuthToken(function (token, apiHost) {
    resolveQueueId(apiHost, token, conversationId, knownQueueId)
      .then(function (queueId) {
        if (!queueId) {
          return getParticipantWrapupCodes(apiHost, token, conversationId, participantId)
            .then(function (codes) {
              if (!codes.length) {
                throw new Error('Aucune file trouvee sur cette conversation, et aucun code wrap-up propose pour le participant.');
              }
              return { queueId: null, codes: codes };
            });
        }

        return Promise.all([
          getAllQueueWrapupCodes(apiHost, token, queueId),
          getQueueWrapupSettings(apiHost, token, queueId)
        ])
          .then(function (results) {
            var codes = results[0] || [];
            var settings = results[1] || {};

            if (codes.length) {
              return { queueId: queueId, codes: codes, wrapupRequired: settings.wrapupRequired };
            }

            // La file existe mais n'a aucun code configure: on tente la liste
            // du participant avant de declarer forfait.
            return getParticipantWrapupCodes(apiHost, token, conversationId, participantId)
              .then(function (fallback) {
                return { queueId: queueId, codes: fallback, wrapupRequired: settings.wrapupRequired };
              });
          });
      })
      .then(function (result) {
        sendToParent({ type: 'genesys:wrapup:codes', data: result });
      })
      .catch(function (error) {
        sendToParent({
          type: 'genesys:wrapup:codes:error',
          data: { message: error.message || String(error) }
        });
      });
  }, function (message) {
    sendToParent({ type: 'genesys:wrapup:codes:error', data: { message: message } });
  });
}

// Relit la conversation quand la notification n'a pas transmis la file. Le
// modele des notifications n'est pas celui de l'API REST: selon l'evenement, la
// file arrive en `queueId` plat, en `queue.id` imbrique, ou pas du tout.
function resolveQueueId(apiHost, token, conversationId, knownQueueId) {
  if (knownQueueId) return Promise.resolve(knownQueueId);
  if (!conversationId) return Promise.resolve(null);

  return genesysApiGet(apiHost + '/api/v2/conversations/calls/' + encodeURIComponent(conversationId), token)
    .then(findConversationQueueId)
    .catch(function () {
      return genesysApiGet(apiHost + '/api/v2/conversations/' + encodeURIComponent(conversationId), token)
        .then(findConversationQueueId)
        .catch(function () { return null; });
    });
}

// La file est portee par le leg qui a recu l'appel. On prend l'agent d'abord,
// puis le participant ACD (le leg non humain qui represente la file elle-meme).
function findConversationQueueId(conversation) {
  var participants = conversation && Array.isArray(conversation.participants) ? conversation.participants : [];
  var purposeOrder = ['agent', 'acd', 'user', 'customer'];
  var i;
  var found;

  for (i = 0; i < purposeOrder.length; i++) {
    found = findQueueIdByPurpose(participants, purposeOrder[i]);
    if (found) return found;
  }

  for (i = 0; i < participants.length; i++) {
    found = getParticipantQueueId(participants[i]);
    if (found) return found;
  }

  return getParticipantQueueId(conversation);
}

function findQueueIdByPurpose(participants, purpose) {
  for (var i = 0; i < participants.length; i++) {
    var participant = participants[i];
    if (normalizePresenceKey(participant && participant.purpose) !== purpose) continue;

    var queueId = getParticipantQueueId(participant);
    if (queueId) return queueId;
  }

  return null;
}

function getParticipantQueueId(participant) {
  if (!participant) return null;
  return (participant.queue && participant.queue.id) || participant.queueId || null;
}

function submitWrapup(data) {
  if (!data || !data.conversationId || !data.participantId || !data.codeId) {
    sendToParent({ type: 'genesys:wrapup:submit:error', data: { message: 'conversationId, participantId ou codeId manquant.' } });
    return;
  }

  withAuthToken(function (token, apiHost) {
    // Attention: .../participants/{id}/wrapup est en LECTURE SEULE
    // (Allow: HEAD,GET,OPTIONS). L'ecriture passe par le participant de la
    // conversation typee media, avec un MediaParticipantRequest.
    var url = apiHost + '/api/v2/conversations/calls/' + encodeURIComponent(data.conversationId) +
      '/participants/' + encodeURIComponent(data.participantId);

    genesysApiFetch(url, token, {
      method: 'PATCH',
      body: {
        wrapup: {
          code: data.codeId,
          notes: data.notes || ''
        }
      }
    })
      .then(function (response) {
        sendToParent({ type: 'genesys:wrapup:submit:success', data: { response: response || null } });
      })
      .catch(function (error) {
        sendToParent({ type: 'genesys:wrapup:submit:error', data: { message: error.message || String(error) } });
      });
  }, function (message) {
    sendToParent({ type: 'genesys:wrapup:submit:error', data: { message: message } });
  });
}

function ensureNotificationUserId(token, apiHost) {
  if (notificationUserId) return Promise.resolve(notificationUserId);

  return genesysApiGet(apiHost + '/api/v2/users/me', token).then(function (user) {
    if (!user || !user.id) throw new Error('Impossible de recuperer users/me.');
    notificationUserId = user.id;
    return notificationUserId;
  });
}

function getAllPresenceDefinitions(apiHost, token) {
  var pageSize = 100;
  var all = [];

  function getPage(pageNumber) {
    return genesysApiGet(apiHost + '/api/v2/presence/definitions?pageSize=' + pageSize + '&pageNumber=' + pageNumber, token)
      .then(function (page) {
        all = all.concat(Array.isArray(page.entities) ? page.entities : []);
        if (page.pageCount && pageNumber < page.pageCount) return getPage(pageNumber + 1);
        return all;
      });
  }

  return getPage(1);
}

function getQueueWrapupSettings(apiHost, token, queueId) {
  if (!queueId) return Promise.resolve({ wrapupRequired: false });

  var url = apiHost + '/api/v2/routing/queues/' + encodeURIComponent(queueId);

  return genesysApiGet(url, token)
    .then(function (queue) {
      var prompt = normalizePresenceKey(queue && queue.acwSettings && queue.acwSettings.wrapupPrompt);
      // Queue-level ACW is the early signal. Participant.wrapupRequired remains
      // authoritative at disconnect; this fallback lets PiP expose mandatory
      // wrap-up while the interaction is still connected.
      return {
        wrapupRequired: prompt === 'mandatory'
      };
    })
    .catch(function () {
      return { wrapupRequired: false };
    });
}

function getParticipantWrapupCodes(apiHost, token, conversationId, participantId) {
  if (!conversationId || !participantId) return Promise.resolve([]);

  var url = apiHost + '/api/v2/conversations/' + encodeURIComponent(conversationId) +
    '/participants/' + encodeURIComponent(participantId) + '/wrapupcodes';

  return genesysApiGet(url, token)
    .then(function (response) {
      var codes = Array.isArray(response) ? response : (response && Array.isArray(response.entities) ? response.entities : []);
      return sortWrapupCodes(codes);
    })
    .catch(function () {
      // Pas bloquant: on laisse la recuperation par file prendre le relais.
      return [];
    });
}

function getAllQueueWrapupCodes(apiHost, token, queueId) {
  var pageSize = 100;
  var all = [];

  function getPage(pageNumber) {
    return genesysApiGet(apiHost + '/api/v2/routing/queues/' + encodeURIComponent(queueId) + '/wrapupcodes?pageSize=' + pageSize + '&pageNumber=' + pageNumber, token)
      .then(function (page) {
        all = all.concat(Array.isArray(page.entities) ? page.entities : []);
        if (page.pageCount && pageNumber < page.pageCount) return getPage(pageNumber + 1);
        return sortWrapupCodes(all);
      });
  }

  return getPage(1);
}

function sortWrapupCodes(codes) {
  return codes
    .filter(function (code) { return code && code.id; })
    .sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
}

function buildQueuePresence(systemPresences, activeDefinitions) {
  var onQueue = findSystemPresenceOption(systemPresences, 'ON_QUEUE') || findDefinitionByKey(activeDefinitions, 'ON_QUEUE');
  var offQueue = findSystemPresenceOption(systemPresences, 'OFF_QUEUE') || findDefinitionByKey(activeDefinitions, 'OFF_QUEUE');

  return {
    onQueue: onQueue || { id: 'ON_QUEUE', label: 'On Queue', systemPresence: 'ON_QUEUE', primary: true },
    offQueue: offQueue || { id: 'OFF_QUEUE', label: 'Off Queue', systemPresence: 'OFF_QUEUE', primary: true }
  };
}

function buildGroupedPresenceStatuses(systemPresences, activeDefinitions) {
  var allowedKeys = ALLOWED_PRIMARY_PRESENCES.map(normalizePresenceKey);
  var primarySources = ALLOWED_PRIMARY_PRESENCES.map(function (allowedPresence) {
    var allowedKey = normalizePresenceKey(allowedPresence);
    var systemMatch = systemPresences.find(function (presence) {
      return normalizePresenceKey(presence.systemPresence) === allowedKey ||
        normalizePresenceKey(presence.id) === allowedKey ||
        normalizePresenceKey(presence.label) === allowedKey;
    });

    var definitionMatch = activeDefinitions.find(function (definition) {
      return normalizePresenceKey(definition.systemPresence) === allowedKey;
    });

    var source = systemMatch || (definitionMatch ? {
      id: definitionMatch.systemPresence,
      label: titleCase(definitionMatch.systemPresence),
      systemPresence: definitionMatch.systemPresence,
      key: allowedKey
    } : {
      id: allowedPresence,
      label: titleCase(allowedPresence),
      systemPresence: allowedPresence,
      key: allowedKey
    });

    return {
      id: source.id || allowedPresence,
      label: source.label || titleCase(allowedPresence),
      systemPresence: source.systemPresence || allowedPresence,
      key: allowedKey
    };
  });

  return primarySources
    .map(function (systemPresence) {
      var children = activeDefinitions.filter(function (definition) {
        var definitionSystemKey = normalizePresenceKey(definition.systemPresence);
        return definitionSystemKey === systemPresence.key && allowedKeys.indexOf(definitionSystemKey) !== -1 && !isRoutingPresenceDefinition(definition);
      });

      var primaryDefinition = findPrimaryDefinition(systemPresence, children);
      var primaryId = primaryDefinition ? primaryDefinition.id : systemPresence.id;
      var secondaryDefinitions = children.filter(function (definition) {
        return !primaryDefinition || definition.id !== primaryDefinition.id;
      });

      return {
        id: primaryId,
        label: systemPresence.label,
        systemPresence: systemPresence.systemPresence,
        primary: true,
        children: secondaryDefinitions.map(function (definition) {
          return toPresenceOption(definition, false);
        }).sort(function (a, b) {
          return a.label.localeCompare(b.label);
        })
      };
    })
    .sort(function (a, b) { return a.label.localeCompare(b.label); });
}

function findSystemPresenceOption(systemPresences, key) {
  var normalizedKey = normalizePresenceKey(key);
  var match = systemPresences.find(function (presence) {
    return normalizePresenceKey(presence.systemPresence) === normalizedKey ||
      normalizePresenceKey(presence.id) === normalizedKey ||
      normalizePresenceKey(presence.label) === normalizedKey;
  });

  return match ? { id: match.id || key, label: match.label || key, systemPresence: match.systemPresence || key, primary: true } : null;
}

function findDefinitionByKey(activeDefinitions, key) {
  var normalizedKey = normalizePresenceKey(key);
  var match = activeDefinitions.find(function (definition) {
    return normalizePresenceKey(definition.systemPresence) === normalizedKey ||
      normalizePresenceKey(definition.name) === normalizedKey ||
      normalizePresenceKey(getPresenceLabel(definition)) === normalizedKey;
  });

  return match ? toPresenceOption(match, true) : null;
}

function normalizeSystemPresences(payload) {
  var items = Array.isArray(payload) ? payload : Array.isArray(payload.entities) ? payload.entities : [];
  return items.filter(Boolean).map(function (presence) {
    var systemPresence = presence.systemPresence || presence.id || presence.name;
    return {
      id: presence.id || systemPresence,
      label: getPresenceLabel(presence),
      systemPresence: systemPresence,
      key: normalizePresenceKey(systemPresence)
    };
  });
}

function findPrimaryDefinition(systemPresence, definitions) {
  if (!definitions || definitions.length === 0) return null;
  return definitions.find(function (definition) { return definition.primary === true; }) ||
    definitions.find(function (definition) { return looksLikePrimaryPresence(systemPresence, definition); }) ||
    null;
}

function looksLikePrimaryPresence(systemPresence, definition) {
  var systemKey = normalizePresenceKey(systemPresence.systemPresence);
  var labelKey = normalizePresenceKey(systemPresence.label);
  var definitionLabelKey = normalizePresenceKey(getPresenceLabel(definition));
  var definitionNameKey = normalizePresenceKey(definition.name);

  return definitionLabelKey === systemKey || definitionLabelKey === labelKey || definitionNameKey === systemKey || definitionNameKey === labelKey;
}

function isRoutingPresenceDefinition(definition) {
  var key = normalizePresenceKey(definition.systemPresence + ' ' + definition.name + ' ' + getPresenceLabel(definition));
  return key.includes('onqueue') || key.includes('offqueue') || key.includes('idle') || key.includes('interacting') || key.includes('notresponding') || key.includes('communicating');
}

function toPresenceOption(definition, primary) {
  return { id: definition.id, label: getPresenceLabel(definition), systemPresence: definition.systemPresence, primary: Boolean(primary) };
}

function withAuthToken(onSuccess, onFailure) {
  if (!window.PureCloud || !window.PureCloud.User || !window.PureCloud.User.getAuthToken) {
    if (onFailure) onFailure('window.PureCloud.User.getAuthToken est indisponible.');
    return;
  }

  var apiHost = getGenesysApiHost();
  var completed = false;
  var timeoutId = setTimeout(function () {
    if (completed) return;
    completed = true;
    if (onFailure) onFailure('Timeout lors de la recuperation du token Genesys Cloud.');
  }, 10000);

  window.PureCloud.User.getAuthToken(function (token) {
    if (completed) return;
    completed = true;
    clearTimeout(timeoutId);

    if (!token) {
      if (onFailure) onFailure('Token Genesys Cloud vide. Verifie enableFrameworkClientId=true et le clientId OAuth.');
      return;
    }

    onSuccess(token, apiHost);
  });
}

function genesysApiGet(url, token) {
  return fetch(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
  })
    .catch(rewrapFetchFailure('GET', url))
    .then(handleApiResponse);
}

function genesysApiFetch(url, token, options) {
  var requestOptions = options || {};
  var method = requestOptions.method || 'GET';

  return fetch(url, {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body)
  })
    .catch(rewrapFetchFailure(method, url))
    .then(handleApiResponse);
}

// fetch() rejette avec un simple « Failed to fetch » quand la requete est
// bloquee par CORS ou injoignable: sans statut HTTP, le message ne dit rien.
// On y remet la methode et le chemin pour rendre l'erreur diagnosticable.
function rewrapFetchFailure(method, url) {
  return function (error) {
    var detail = error && error.message ? error.message : String(error);
    throw new Error(method + ' ' + getApiPath(url) + ' injoignable ou bloque (CORS / reseau): ' + detail);
  };
}

function getApiPath(url) {
  var index = String(url).indexOf('/api/v2/');
  return index === -1 ? String(url) : String(url).substring(index).split('?')[0];
}

function handleApiResponse(response) {
  if (!response.ok) {
    return response.text().then(function (body) {
      throw new Error('Genesys API request failed: HTTP ' + response.status + ' - ' + body);
    });
  }

  if (response.status === 204) return null;
  return response.json();
}

function getPresenceLabel(presence) {
  if (presence && presence.languageLabels) {
    var lang = navigator.language || navigator.userLanguage || 'en-US';
    var normalizedLang = lang.replace('-', '_');
    if (presence.languageLabels[normalizedLang]) return presence.languageLabels[normalizedLang];
    if (presence.languageLabels[lang]) return presence.languageLabels[lang];
    if (presence.languageLabels.fr_FR) return presence.languageLabels.fr_FR;
    if (presence.languageLabels.en_US) return presence.languageLabels.en_US;
    var firstKey = Object.keys(presence.languageLabels)[0];
    if (firstKey) return presence.languageLabels[firstKey];
  }

  return presence.name || presence.systemPresence || presence.id || 'Statut';
}

function titleCase(value) {
  return String(value || '').toLowerCase().split('_').map(function (part) {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

function normalizePresenceKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getGenesysApiHost() {
  var host = window.location.hostname;
  if (host === 'apps.mypurecloud.com') return 'https://api.mypurecloud.com';
  if (host === 'apps.mypurecloud.ie') return 'https://api.mypurecloud.ie';
  if (host === 'apps.mypurecloud.de') return 'https://api.mypurecloud.de';
  if (host === 'apps.mypurecloud.com.au') return 'https://api.mypurecloud.com.au';
  if (host === 'apps.mypurecloud.jp') return 'https://api.mypurecloud.jp';
  if (host === 'apps.cac1.pure.cloud') return 'https://api.cac1.pure.cloud';
  if (host === 'apps.euw2.pure.cloud') return 'https://api.euw2.pure.cloud';
  if (host === 'apps.apne2.pure.cloud') return 'https://api.apne2.pure.cloud';
  if (host.startsWith('apps.')) return 'https://api.' + host.substring('apps.'.length);
  return 'https://api.mypurecloud.ie';
}

function sendToParent(payload) {
  window.parent.postMessage(JSON.stringify(payload), '*');
}
