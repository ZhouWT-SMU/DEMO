const moduleTitle = document.getElementById('moduleTitle');
const moduleDescription = document.getElementById('moduleDescription');

const API_BASE_URL = '/api/chat';
const AUTH_URL = '/api/auth/login';
const CAPABILITY_API_BASE = '/api/capability';
const STORAGE_KEYS = {
    userId: 'enterpriseChatUserId',
    conversationPrefix: 'enterpriseChatConversation:',
    historyPrefix: 'enterpriseChatHistory:',
};

const panelStates = new WeakMap();
let cachedUserId = null;
let currentUser = null;
let submissionCache = [];
let uploadHistory = [];

if (window.marked) {
    window.marked.setOptions({
        breaks: true,
        gfm: true,
    });
}

function getStorage() {
    try {
        return window.localStorage;
    } catch (error) {
        console.warn('本地存储不可用，使用临时会话。', error);
        return null;
    }
}

const storage = getStorage();

function getUserId() {
    if (cachedUserId) {
        return cachedUserId;
    }

    if (storage) {
        const existing = storage.getItem(STORAGE_KEYS.userId);
        if (existing) {
            cachedUserId = existing;
            return cachedUserId;
        }
    }

    const generated = `web-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    if (storage) {
        storage.setItem(STORAGE_KEYS.userId, generated);
    }
    cachedUserId = generated;
    return cachedUserId;
}

function getPanelState(panel) {
    let state = panelStates.get(panel);
    if (state) {
        return state;
    }

    const key = panel.dataset.conversationKey || null;
    let conversationId = null;

    if (key && storage) {
        conversationId = storage.getItem(`${STORAGE_KEYS.conversationPrefix}${key}`);
    }

    state = {
        conversationKey: key,
        conversationId: conversationId || null,
        historyEntries: [],
        isLoading: false,
    };

    if (key && storage) {
        try {
            const rawHistory = storage.getItem(`${STORAGE_KEYS.historyPrefix}${key}`);
            if (rawHistory) {
                const parsed = JSON.parse(rawHistory);
                if (Array.isArray(parsed)) {
                    state.historyEntries = parsed;
                }
            }
        } catch (error) {
            console.warn('历史对话读取失败，使用空列表。', error);
            state.historyEntries = [];
        }
    }

    panelStates.set(panel, state);
    return state;
}

function persistConversationId(state, conversationId) {
    if (!state) {
        return;
    }

    state.conversationId = conversationId;

    if (state.conversationKey && storage && conversationId) {
        storage.setItem(`${STORAGE_KEYS.conversationPrefix}${state.conversationKey}`, conversationId);
    }

    if (state.conversationKey && storage && !conversationId) {
        storage.removeItem(`${STORAGE_KEYS.conversationPrefix}${state.conversationKey}`);
    }
}

function persistHistoryEntries(state) {
    if (!state || !state.conversationKey || !storage) {
        return;
    }

    try {
        storage.setItem(
            `${STORAGE_KEYS.historyPrefix}${state.conversationKey}`,
            JSON.stringify(state.historyEntries || []),
        );
    } catch (error) {
        console.warn('历史对话保存失败：', error);
    }
}

function handleNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const modules = document.querySelectorAll('.module');

    const setActiveModule = (item) => {
        if (!item || item.classList.contains('hidden')) {
            return;
        }

        menuItems.forEach((button) => button.classList.remove('active'));
        modules.forEach((section) => section.classList.remove('active'));

        item.classList.add('active');
        const targetId = item.dataset.target;
        const targetModule = document.getElementById(targetId);

        if (targetModule) {
            targetModule.classList.add('active');
        }

        if (moduleTitle) {
            moduleTitle.textContent = item.dataset.title || '';
        }

        if (moduleDescription) {
            moduleDescription.textContent = item.dataset.description || '';
        }
    };

    menuItems.forEach((item) => {
        item.addEventListener('click', () => {
            if (item.classList.contains('active') || item.classList.contains('hidden')) {
                return;
            }

            setActiveModule(item);
        });
    });

    return {
        setActiveModule,
    };
}

function renderAssistantMessage(target, content) {
    if (!target) {
        return;
    }

    if (window.marked && typeof window.marked.parse === 'function') {
        target.innerHTML = window.marked.parse(content || '');
    } else {
        target.textContent = content;
    }
}

function updateUserStatus(statusText) {
    const statusEl = document.getElementById('userStatus');
    if (statusEl) {
        statusEl.textContent = statusText || '请先登录';
    }
}

function applyRoleVisibility(role, navigationApi) {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach((btn) => {
        const requiredRole = btn.dataset.roleVisible;
        if (requiredRole && requiredRole !== role) {
            btn.classList.add('hidden');
            if (btn.classList.contains('active')) {
                btn.classList.remove('active');
            }
        } else {
            btn.classList.remove('hidden');
        }
    });

    const active = document.querySelector('.menu-item.active:not(.hidden)');
    if (!active) {
        const first = document.querySelector('.menu-item:not(.hidden)');
        if (first && navigationApi?.setActiveModule) {
            navigationApi.setActiveModule(first);
        }
    }

    const capabilityModule = document.getElementById('capabilityModule');
    if (capabilityModule) {
        capabilityModule.classList.toggle('hidden', role !== 'ENTERPRISE');
    }
}

async function login(username, password) {
    const response = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });

    const payload = await response.json();
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || '登录失败');
    }
    return payload;
}

function setupAuth(navigationApi) {
    const overlay = document.getElementById('authOverlay');
    const form = document.getElementById('loginForm');
    const messageEl = document.getElementById('loginMessage');

    if (!form) {
        return;
    }

    const setSession = (session) => {
        if (session.role !== 'ENTERPRISE') {
            messageEl.textContent = '请使用企业账号登录，此入口不支持审批中心账号。';
            messageEl.classList.add('visible');
            return;
        }

        currentUser = session;
        updateUserStatus(`${session.displayName}（企业用户）`);
        applyRoleVisibility(session.role, navigationApi);

        if (overlay) {
            overlay.classList.add('hidden');
        }

        fetchUploadHistory();
        renderUploadHistory(uploadHistory);
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const username = formData.get('username');
        const password = formData.get('password');

        try {
            messageEl.textContent = '正在登录...';
            messageEl.classList.add('visible');
            const session = await login(username, password);
            setSession(session);
            messageEl.textContent = '登录成功';
        } catch (error) {
            messageEl.textContent = error.message || '登录失败，请重试';
            messageEl.classList.add('visible');
        }
    });
}

function formatStatus(status) {
    const normalised = (status || '').toUpperCase();
    if (normalised === 'APPROVED') {
        return { text: '已通过', className: 'approved' };
    }
    if (normalised === 'REJECTED') {
        return { text: '已拒绝', className: 'rejected' };
    }
    return { text: '待审核', className: 'pending' };
}

function formatDateTime(value) {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return date.toLocaleString('zh-CN', { hour12: false });
}

function updateApprovalStats(list = []) {
    const pending = list.filter((item) => (item.status || '').toUpperCase() === 'PENDING').length;
    const approved = list.filter((item) => (item.status || '').toUpperCase() === 'APPROVED').length;
    const rejected = list.filter((item) => (item.status || '').toUpperCase() === 'REJECTED').length;

    const statPending = document.getElementById('statPending');
    const statApproved = document.getElementById('statApproved');
    const statRejected = document.getElementById('statRejected');

    if (statPending) statPending.textContent = pending;
    if (statApproved) statApproved.textContent = approved;
    if (statRejected) statRejected.textContent = rejected;
}

function renderApprovalDetail(submission) {
    const detail = document.getElementById('approvalDetail');
    if (!detail) {
        return;
    }

    if (!submission) {
        detail.hidden = true;
        detail.innerHTML = '';
        return;
    }

    const statusInfo = formatStatus(submission.status);
    detail.dataset.id = submission.id;
    detail.hidden = false;
    detail.innerHTML = `
        <div class="detail-header">
            <div>
                <div class="tag ${statusInfo.className}">${statusInfo.text}</div>
                <h3>${submission.companyName || '未命名企业'}</h3>
                <p class="muted">提交人：${submission.submittedBy || '未知'} · ${formatDateTime(submission.createdAt)}</p>
            </div>
            <div class="muted">统一信用代码：${submission.creditCode || '-'}</div>
        </div>
        <div class="result-grid compact">
            <div><span>企业规模</span><strong>${submission.companyScale || '-'}</strong></div>
            <div><span>企业类型</span><strong>${submission.companyType || '-'}</strong></div>
            <div><span>企业地址</span><strong>${submission.companyAddress || '-'}</strong></div>
            <div><span>联系人</span><strong>${submission.contactName || '-'}</strong></div>
            <div><span>联系方式</span><strong>${submission.contactInfo || '-'}</strong></div>
            <div><span>提交时间</span><strong>${formatDateTime(submission.createdAt)}</strong></div>
            <div><span>处理时间</span><strong>${formatDateTime(submission.decisionAt)}</strong></div>
            <div><span>处理备注</span><strong>${submission.decisionRemark || '—'}</strong></div>
        </div>
        <div class="result-section"><h4>业务简介</h4><p>${submission.businessIntro || '—'}</p></div>
        ${renderArraySection('核心产品', submission.coreProducts)}
        ${renderArraySection('知识产权', submission.intellectualProperties)}
        ${renderArraySection('专利', submission.patents)}
    `;
}

function renderApprovalList(list = []) {
    submissionCache = list;
    const listEl = document.getElementById('approvalList');
    if (!listEl) {
        return;
    }

    updateApprovalStats(list);
    listEl.innerHTML = '';

    if (!list.length) {
        listEl.innerHTML = '<div class="history-empty">暂无提交记录</div>';
        return;
    }

    list.forEach((item) => {
        const statusInfo = formatStatus(item.status);
        const card = document.createElement('div');
        card.className = 'approval-card';
        card.innerHTML = `
            <div class="approval-meta">
                <div class="meta-top">
                    <h4>${item.companyName || '未命名企业'}</h4>
                    <div class="tag ${statusInfo.className}">${statusInfo.text}</div>
                </div>
                <p class="muted">提交人：${item.submittedBy || '未知'} · ${formatDateTime(item.createdAt)}</p>
                <p class="muted">统一信用代码：${item.creditCode || '-'}</p>
            </div>
            <div class="approval-actions">
                <button class="ghost-btn" data-approval-action="view" data-id="${item.id}">查看</button>
                <button class="ghost-btn" data-approval-action="approve" data-id="${item.id}">同意</button>
                <button class="ghost-btn" data-approval-action="reject" data-id="${item.id}">拒绝</button>
            </div>
        `;
        listEl.appendChild(card);
    });
}

async function fetchSubmissions() {
    if (!currentUser || currentUser.role !== 'ADMIN') {
        return;
    }

    try {
        const response = await fetch(`${CAPABILITY_API_BASE}/submissions`, {
            headers: { 'X-Auth-Token': currentUser.token },
        });

        if (!response.ok) {
            throw new Error('审批列表加载失败');
        }
        const list = await response.json();
        renderApprovalList(Array.isArray(list) ? list : []);
    } catch (error) {
        console.error('加载审批列表失败', error);
    }
}

function setupApprovalModule() {
    const listEl = document.getElementById('approvalList');
    const detailEl = document.getElementById('approvalDetail');
    const refreshBtn = document.getElementById('refreshSubmissions');

    if (!listEl) {
        return;
    }

    listEl.addEventListener('click', async (event) => {
        const actionBtn = event.target.closest('[data-approval-action]');
        if (!actionBtn) {
            return;
        }

        const id = actionBtn.dataset.id;
        const action = actionBtn.dataset.approvalAction;
        const submission = submissionCache.find((entry) => entry.id === id);

        if (action === 'view') {
            renderApprovalDetail(submission);
            return;
        }

        if (!currentUser || currentUser.role !== 'ADMIN') {
            return;
        }

        try {
            await fetch(`${CAPABILITY_API_BASE}/submissions/${id}/decision`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-Token': currentUser.token,
                },
                body: JSON.stringify({ decision: action }),
            });
            await fetchSubmissions();
            const updated = submissionCache.find((entry) => entry.id === id);
            if (detailEl && !detailEl.hidden && updated) {
                renderApprovalDetail(updated);
            }
        } catch (error) {
            console.error('审批失败', error);
        }
    });

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => fetchSubmissions());
    }

    if (detailEl) {
        detailEl.hidden = true;
    }
}

function safeJsonParse(text, fallback = null) {
    try {
        return JSON.parse(text);
    } catch (error) {
        return fallback;
    }
}

function processSseBuffer(buffer, handleEvent) {
    if (!handleEvent) {
        return buffer;
    }

    const blocks = buffer.split('\n\n');
    buffer = blocks.pop();

    blocks.forEach((block) => {
        if (!block.trim()) {
            return;
        }

        const lines = block.split('\n');
        let eventName = 'message';
        const dataLines = [];

        lines.forEach((line) => {
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
                return;
            }

            if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
            }
        });

        const data = dataLines.join('\n');
        handleEvent(eventName || 'message', data);
    });

    return buffer;
}

function appendMessage(history, role, content, labels, options = {}) {
    if (!history) {
        return null;
    }

    const message = document.createElement('div');
    message.className = `message ${role}`;

    if (options.pending) {
        message.classList.add('pending');
    }

    if (options.id) {
        message.dataset.messageId = options.id;
    }

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = role === 'user' ? labels.user : labels.assistant;

    const body = document.createElement('div');
    body.className = 'message-body';

    const shouldRenderMarkdown = role === 'assistant'
        && options.pending !== true
        && options.renderMarkdown !== false;

    if (shouldRenderMarkdown) {
        renderAssistantMessage(body, content);
    } else {
        body.textContent = content;
    }

    message.append(meta, body);
    history.appendChild(message);
    const scrollContainer = history.closest('.chat-history') || history;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;

    return { element: message, body };
}

function getMessages(history) {
    return history ? Array.from(history.querySelectorAll('.message')) : [];
}

function clearConversationHistory(history, { keepFirstAssistant = true } = {}) {
    if (!history) {
        return;
    }

    const messages = getMessages(history);

    if (keepFirstAssistant && messages.length > 0) {
        const firstAssistant = messages.find((item) => item.classList.contains('assistant'));
        history.innerHTML = '';
        if (firstAssistant) {
            history.appendChild(firstAssistant.cloneNode(true));
        }
        return;
    }

    history.innerHTML = '';
}

function setupHistoryThreads(history) {
    if (!history) {
        return null;
    }

    const initialThread = document.createElement('div');
    initialThread.className = 'history-thread active';
    initialThread.dataset.threadId = 'default';

    const existingMessages = Array.from(history.childNodes);
    existingMessages.forEach((node) => initialThread.appendChild(node));

    history.appendChild(initialThread);

    const greetingTemplate = (() => {
        const greeting = initialThread.querySelector('.message.assistant');
        return greeting ? greeting.cloneNode(true) : null;
    })();

    const normaliseId = (id) => id || 'default';

    const getActiveThread = () => history.querySelector('.history-thread.active') || initialThread;

    const ensureThread = (threadId, { withGreeting = false } = {}) => {
        const safeId = normaliseId(threadId);
        let thread = history.querySelector(`.history-thread[data-thread-id="${safeId}"]`);

        if (!thread) {
            thread = document.createElement('div');
            thread.className = 'history-thread';
            thread.dataset.threadId = safeId;

            if (withGreeting && greetingTemplate) {
                thread.appendChild(greetingTemplate.cloneNode(true));
            }

            history.appendChild(thread);
        }

        return thread;
    };

    const setActiveThread = (threadId, { withGreeting = false } = {}) => {
        const thread = ensureThread(threadId, { withGreeting });

        history.querySelectorAll('.history-thread').forEach((node) => {
            node.classList.toggle('active', node === thread);
        });

        history.scrollTop = history.scrollHeight;
        return thread;
    };

    const resetThread = (thread, { includeGreeting = false } = {}) => {
        if (!thread) {
            return;
        }

        thread.innerHTML = '';

        if (includeGreeting && greetingTemplate) {
            thread.appendChild(greetingTemplate.cloneNode(true));
        }
    };

    const getThreadById = (threadId) => history.querySelector(`.history-thread[data-thread-id="${normaliseId(threadId)}"]`);

    const removeThread = (threadId) => {
        const target = getThreadById(threadId);
        if (target && target !== initialThread) {
            target.remove();
        }
    };

    const scrollToBottom = () => {
        history.scrollTop = history.scrollHeight;
    };

    return {
        greetingTemplate,
        getActiveThread,
        setActiveThread,
        ensureThread,
        resetThread,
        getThreadById,
        removeThread,
        scrollToBottom,
    };
}

function normalizeHistoryTitle(text) {
    if (!text) {
        return '未命名对话';
    }

    const sanitized = text.replace(/\s+/g, ' ').trim();
    if (sanitized.length <= 40) {
        return sanitized;
    }

    return `${sanitized.slice(0, 40)}...`;
}

function addHistoryEntry(panelState, title, { maxEntries = 30, conversationId = null } = {}) {
    if (!panelState) {
        return null;
    }

    const entry = {
        id: `h-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        title: normalizeHistoryTitle(title),
        conversationId: conversationId || null,
    };

    const existing = Array.isArray(panelState.historyEntries) ? panelState.historyEntries : [];
    panelState.historyEntries = [entry, ...existing].slice(0, maxEntries);
    persistHistoryEntries(panelState);

    return entry.id;
}

function renderHistoryList(listElement, entries, { onDelete, onSelect, activeId } = {}) {
    if (!listElement) {
        return;
    }

    listElement.innerHTML = '';

    if (!entries || entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = '暂无历史对话';
        listElement.appendChild(empty);
        return;
    }

    entries.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'history-item';

        if (entry.id === activeId) {
            item.classList.add('active');
        }

        item.addEventListener('click', () => {
            if (typeof onSelect === 'function') {
                onSelect(entry.id, entry);
            }
        });

        const title = document.createElement('div');
        title.className = 'history-title-text';
        title.textContent = entry.title || '未命名对话';

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'history-delete';
        deleteButton.innerHTML = '<span aria-hidden="true">🗑️</span><span>删除</span>';
        deleteButton.addEventListener('click', () => {
            if (typeof onSelect === 'function') {
                onSelect(null, null);
            }

            if (typeof onDelete === 'function') {
                onDelete(entry.id);
            }
        });

        deleteButton.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        item.append(title, deleteButton);
        listElement.appendChild(item);
    });
}

function setupHistoryPanel(panelState, historyContainer, historyList, chatHistory, threads, { onSelect } = {}) {
    const newConversationButton = historyContainer ? historyContainer.querySelector('[data-conversation-new]') : null;

    function getEntry(entryId) {
        if (!entryId) {
            return null;
        }

        return (panelState.historyEntries || []).find((item) => item.id === entryId) || null;
    }

    function refreshHistory() {
        if (newConversationButton) {
            newConversationButton.disabled = false;
        }

        renderHistoryList(historyList, panelState.historyEntries, {
            onDelete: handleDeleteEntry,
            onSelect: handleSelectEntry,
            activeId: panelState.activeHistoryId,
        });
    }

    function handleDeleteEntry(entryId) {
        const existing = Array.isArray(panelState.historyEntries) ? panelState.historyEntries : [];
        panelState.historyEntries = existing.filter((item) => item.id !== entryId);
        persistHistoryEntries(panelState);

        if (panelState.activeHistoryId === entryId) {
            panelState.activeHistoryId = null;
            const defaultThread = threads ? threads.setActiveThread(null, { withGreeting: true }) : null;
            if (defaultThread) {
                clearConversationHistory(defaultThread, { keepFirstAssistant: true });
            }
            persistConversationId(panelState, null);
        }

        if (panelState.historyEntries.length === 0 && chatHistory) {
            const defaultThread = threads ? threads.setActiveThread(null, { withGreeting: true }) : chatHistory;
            clearConversationHistory(defaultThread, { keepFirstAssistant: true });
            persistConversationId(panelState, null);
            panelState.activeHistoryId = null;
        }

        if (threads) {
            threads.removeThread(entryId);
        }

        refreshHistory();
    }

    function handleSelectEntry(entryId, entry) {
        panelState.activeHistoryId = entryId || null;
        refreshHistory();

        if (typeof onSelect === 'function') {
            onSelect(entry || getEntry(entryId));
        }
    }

    if (newConversationButton) {
        newConversationButton.addEventListener('click', () => {
            const newEntryId = addHistoryEntry(panelState, '新建对话', { conversationId: null });
            const entry = getEntry(newEntryId);
            panelState.isLoading = false;
            persistConversationId(panelState, null);
            handleSelectEntry(newEntryId, entry);
        });
    }

    refreshHistory();

    return {
        refreshHistory,
        recordEntry: (text) => {
            if (!text) {
                return;
            }

            const entryId = addHistoryEntry(panelState, text, { conversationId: panelState.conversationId });
            refreshHistory();
            handleSelectEntry(entryId);
            return entryId;
        },
        updateEntry: (entryId, updates = {}) => {
            if (!entryId) {
                return;
            }

            const existing = Array.isArray(panelState.historyEntries) ? [...panelState.historyEntries] : [];
            const idx = existing.findIndex((item) => item.id === entryId);
            if (idx === -1) {
                return;
            }

            existing[idx] = { ...existing[idx], ...updates };
            panelState.historyEntries = existing;
            persistHistoryEntries(panelState);
            refreshHistory();
        },
        setActive: (entryId) => {
            handleSelectEntry(entryId, getEntry(entryId));
        },
        getEntry,
    };
}

function setupChatPanels() {
    const panels = document.querySelectorAll('[data-chat]');

    panels.forEach((panel) => {
        const history = panel.querySelector('[data-chat-history]');
        const input = panel.querySelector('[data-chat-input]');
        const sendButton = panel.querySelector('[data-chat-send]');

        if (!history || !input || !sendButton) {
            return;
        }

        const threadManager = setupHistoryThreads(history);

        if (!threadManager) {
            return;
        }

        const labels = {
            user: panel.dataset.userLabel || '我',
            assistant: panel.dataset.assistantLabel || '智能助手',
        };

        const replyTemplate = panel.dataset.replyTemplate
            || '已记录您的需求“{message}”。我们将结合企业画像为您准备相应的服务建议。';

        const panelState = getPanelState(panel);
        const defaultSendLabel = sendButton.textContent;
        const wrapper = panel.closest('.chat-workspace, .chat-with-history, .assistant-support, .module-grid');
        const historyContainer = wrapper
            ? wrapper.querySelector(`.conversation-history[data-conversation-key="${panel.dataset.conversationKey || ''}"]`)
            : null;
        const historyList = historyContainer ? historyContainer.querySelector('[data-history-list]') : null;

        const setSendButtonState = (isBusy, label = defaultSendLabel) => {
            sendButton.disabled = isBusy;
            sendButton.textContent = label;
        };

        const extractMessageText = (message) => {
            if (!message) {
                return '';
            }

            if (Array.isArray(message.content)) {
                const contentBlock = message.content.find((block) => block.text || (block.data && block.data.text))
                    || message.content[0];
                if (contentBlock?.text) {
                    return contentBlock.text;
                }
                if (contentBlock?.data?.text) {
                    return contentBlock.data.text;
                }
            }

            return message.answer || message.query || message.message || message.text || '';
        };

        async function loadConversation(entry) {
            if (!entry) {
                const defaultThread = threadManager.setActiveThread(null, { withGreeting: true });
                clearConversationHistory(defaultThread, { keepFirstAssistant: true });
                persistConversationId(panelState, null);
                return;
            }

            if (!entry.conversationId) {
                const targetThread = threadManager.setActiveThread(entry.id, { withGreeting: true });
                const hasMessages = !!targetThread.querySelector('.message');

                if (!hasMessages) {
                    clearConversationHistory(targetThread, { keepFirstAssistant: true });
                }

                persistConversationId(panelState, null);
                panelState.activeHistoryId = entry.id;
                historyManager.refreshHistory();
                threadManager.scrollToBottom();
                return;
            }

            const targetThread = threadManager.setActiveThread(entry.id);

            if (
                targetThread.dataset.loaded === 'true'
                && targetThread.dataset.conversationId === entry.conversationId
            ) {
                panelState.activeHistoryId = entry.id;
                persistConversationId(panelState, entry.conversationId);
                historyManager.refreshHistory();
                threadManager.scrollToBottom();
                return;
            }

            panelState.isLoading = true;
            setSendButtonState(true, '加载中…');
            historyManager.refreshHistory();

            try {
                const response = await fetch(
                    `${API_BASE_URL}/history/${entry.conversationId}?userId=${getUserId()}&limit=50`,
                );

                if (!response.ok) {
                    throw new Error(`加载历史对话失败：${response.status}`);
                }

                const payload = await response.json();
                const messages = Array.isArray(payload.data) ? payload.data : [];

                targetThread.dataset.loaded = 'true';
                targetThread.dataset.conversationId = entry.conversationId;
                clearConversationHistory(targetThread, { keepFirstAssistant: false });

                messages.forEach((item) => {
                    const role = (item.role || '').toLowerCase() === 'user' ? 'user' : 'assistant';
                    const content = extractMessageText(item);
                    appendMessage(targetThread, role, content, labels);
                });

                persistConversationId(panelState, entry.conversationId);
                panelState.activeHistoryId = entry.id;
                historyManager.refreshHistory();
                threadManager.scrollToBottom();
            } catch (error) {
                console.error('加载历史对话失败', error);
            } finally {
                panelState.isLoading = false;
                setSendButtonState(false);
                historyManager.refreshHistory();
            }
        }

        const historyManager = setupHistoryPanel(panelState, historyContainer, historyList, history, threadManager, {
            onSelect: (entry) => {
                loadConversation(entry);
            },
        });

        const sendCurrentMessage = async () => {
            const text = input.value.trim();
            if (!text || panelState.isLoading) {
                return;
            }

            let historyEntryId = panelState.activeHistoryId;
            if (!historyEntryId) {
                historyEntryId = historyManager.recordEntry(text) || panelState.activeHistoryId;
            } else {
                historyManager.updateEntry(historyEntryId, { title: normalizeHistoryTitle(text) });
            }

            const activeThread = threadManager.setActiveThread(historyEntryId, { withGreeting: true });

            appendMessage(activeThread, 'user', text, labels);
            input.value = '';
            input.focus();

            panelState.isLoading = true;
            setSendButtonState(true, '发送中…');
            historyManager.refreshHistory();

            const pending = appendMessage(activeThread, 'assistant', '正在生成回复…', labels, {
                pending: true,
                renderMarkdown: false,
            });
            pending.body.textContent = '';
            const payload = {
                message: text,
                userId: getUserId(),
            };

            if (panelState.conversationId) {
                payload.conversationId = panelState.conversationId;
            }

            const streamQueue = [];
            let streamAnimation = null;

            const flushQueue = () => {
                const batchSize = Math.min(8, Math.max(1, streamQueue.length));
                const slice = streamQueue.splice(0, batchSize);

                slice.forEach((char) => {
                    pending.body.textContent += char;
                });

                threadManager.scrollToBottom();

                if (streamQueue.length > 0) {
                    streamAnimation = requestAnimationFrame(flushQueue);
                } else {
                    streamAnimation = null;
                }
            };

            const appendStreamText = (textChunk) => {
                if (!textChunk) {
                    return;
                }

                streamQueue.push(...Array.from(textChunk));

                if (!streamAnimation) {
                    streamAnimation = requestAnimationFrame(flushQueue);
                }
            };

            const flushRemaining = () => {
                if (streamAnimation) {
                    cancelAnimationFrame(streamAnimation);
                    streamAnimation = null;
                }

                if (streamQueue.length > 0) {
                    streamQueue.splice(0).forEach((char) => {
                        pending.body.textContent += char;
                    });
                }

                threadManager.scrollToBottom();
            };

            try {
                const response = await fetch(`${API_BASE_URL}/send-stream`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'text/event-stream',
                    },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    throw new Error(`请求失败，状态码 ${response.status}`);
                }

                if (!response.body) {
                    throw new Error('未收到流式响应');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                let streamError = null;
                let finalMeta = null;
                let answer = '';

                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    buffer = processSseBuffer(buffer, (eventName, data) => {
                        if (eventName === 'chunk') {
                            answer += data;
                            appendStreamText(data);
                            return;
                        }

                        if (eventName === 'done') {
                            finalMeta = safeJsonParse(data, {});
                            return;
                        }

                        if (eventName === 'error') {
                            streamError = new Error(data || '流式响应错误');
                        }
                    });

                    if (streamError) {
                        throw streamError;
                    }
                }

                buffer = processSseBuffer(`${buffer}\n\n`, (eventName, data) => {
                    if (eventName === 'chunk') {
                        answer += data;
                        appendStreamText(data);
                        return;
                    }

                    if (eventName === 'done' && !finalMeta) {
                        finalMeta = safeJsonParse(data, {});
                    }
                });

                flushRemaining();

                if (streamError) {
                    throw streamError;
                }

                if (!finalMeta) {
                    throw new Error('未收到完成事件');
                }

                const resolvedAnswer = (finalMeta && finalMeta.answer ? finalMeta.answer : answer || '').trim();

                renderAssistantMessage(pending.body, resolvedAnswer || '对话已完成。');
                pending.element.classList.remove('pending');

                if (finalMeta && finalMeta.conversationId) {
                    persistConversationId(panelState, finalMeta.conversationId);
                    if (historyEntryId) {
                        historyManager.updateEntry(historyEntryId, { conversationId: finalMeta.conversationId });
                        const thread = threadManager.getThreadById(historyEntryId);
                        if (thread) {
                            thread.dataset.loaded = 'true';
                            thread.dataset.conversationId = finalMeta.conversationId;
                        }
                    }
                }
            } catch (error) {
                console.error('调用智能助手失败:', error);
                pending.element.classList.remove('pending');
                pending.element.classList.add('error');

                if (replyTemplate) {
                    pending.body.textContent = replyTemplate.replace('{message}', text);
                } else {
                    pending.body.textContent = `抱歉，暂时无法获取智能助手回复：${error.message}`;
                }
            } finally {
                panelState.isLoading = false;
                sendButton.disabled = false;
                sendButton.textContent = defaultSendLabel;
                threadManager.scrollToBottom();
                historyManager.refreshHistory();
            }
        };

        sendButton.addEventListener('click', sendCurrentMessage);

        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendCurrentMessage();
            }
        });

        const suggestions = panel.querySelectorAll('[data-chat-suggestion]');
        suggestions.forEach((button) => {
            button.addEventListener('click', () => {
                input.value = button.dataset.text || '';
                input.focus();
            });
        });
    });
}

function createDynamicItem(container) {
    const item = document.createElement('div');
    item.className = 'dynamic-item';

    const input = document.createElement('input');
    input.type = 'text';
    input.name = container.dataset.name;
    input.placeholder = container.dataset.placeholder || '';

    if (container.dataset.required === 'true') {
        input.required = true;
    }

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'remove-item';
    removeButton.setAttribute('aria-label', '删除');
    removeButton.textContent = '×';

    item.append(input, removeButton);
    return item;
}

function updateRemoveButtons(container) {
    const items = container.querySelectorAll('.dynamic-item');
    const shouldShow = items.length > 1;
    items.forEach((item) => {
        const removeButton = item.querySelector('.remove-item');
        if (removeButton) {
            removeButton.style.visibility = shouldShow ? 'visible' : 'hidden';
        }
    });
}

function setupDynamicList(containerId) {
    const container = document.getElementById(containerId);
    const addButton = document.querySelector(`.add-item[data-target="${containerId}"]`);

    if (!container || !addButton) {
        return;
    }

    if (container.dataset.required === 'true') {
        const firstInput = container.querySelector('input');
        if (firstInput) {
            firstInput.required = true;
        }
    }

    updateRemoveButtons(container);

    addButton.addEventListener('click', () => {
        const newItem = createDynamicItem(container);
        container.appendChild(newItem);
        const newInput = newItem.querySelector('input');
        if (newInput) {
            newInput.focus();
        }
        updateRemoveButtons(container);
    });

    container.addEventListener('click', (event) => {
        if (event.target.classList.contains('remove-item')) {
            const item = event.target.closest('.dynamic-item');
            if (item) {
                item.remove();
                updateRemoveButtons(container);
            }
        }
    });
}

function normaliseFormData(formData) {
    const result = {};

    formData.forEach((value, key) => {
        const normalisedKey = key.endsWith('[]') ? key.slice(0, -2) : key;
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            return;
        }

        if (Object.prototype.hasOwnProperty.call(result, normalisedKey)) {
            if (!Array.isArray(result[normalisedKey])) {
                result[normalisedKey] = [result[normalisedKey]];
            }
            result[normalisedKey].push(trimmedValue);
        } else {
            result[normalisedKey] = trimmedValue;
        }
    });

    return result;
}

function renderArraySection(title, values) {
    if (!values || values.length === 0) {
        return '';
    }

    const listItems = values
        .map((entry) => `<li>${entry}</li>`)
        .join('');

    return `
        <div class="result-section">
            <h4>${title}</h4>
            <ul>${listItems}</ul>
        </div>
    `;
}

function renderUploadHistory(list = []) {
    const container = document.getElementById('uploadHistoryList');
    if (!container) {
        return;
    }

    container.innerHTML = '';

    if (!currentUser || currentUser.role !== 'ENTERPRISE') {
        container.innerHTML = '<div class="history-empty">请使用企业账号登录后查看上传记录</div>';
        return;
    }

    if (!list.length) {
        container.innerHTML = '<div class="history-empty">暂无上传记录，提交后可在此查看进度</div>';
        return;
    }

    list.forEach((item) => {
        const statusInfo = formatStatus(item.status);
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
            <div class="history-row">
                <div>
                    <div class="history-title-row">
                        <h4>${item.companyName || '未命名企业'}</h4>
                        <div class="tag ${statusInfo.className}">${statusInfo.text}</div>
                    </div>
                    <p class="muted">提交时间：${formatDateTime(item.createdAt)}</p>
                    <p class="muted">审核时间：${formatDateTime(item.decisionAt)}</p>
                </div>
                <div class="history-meta">
                    <span class="muted">统一信用代码</span>
                    <strong>${item.creditCode || '-'}</strong>
                    <span class="muted">${item.companyType || ''}</span>
                </div>
            </div>
            ${item.decisionRemark ? `<p class="muted">备注：${item.decisionRemark}</p>` : ''}
        `;

        container.appendChild(card);
    });
}

async function fetchUploadHistory() {
    if (!currentUser || currentUser.role !== 'ENTERPRISE') {
        renderUploadHistory([]);
        return;
    }

    try {
        const response = await fetch(`${CAPABILITY_API_BASE}/my-submissions`, {
            headers: { 'X-Auth-Token': currentUser.token },
        });

        if (!response.ok) {
            throw new Error('上传历史获取失败');
        }
        const list = await response.json();
        uploadHistory = Array.isArray(list) ? list : [];
        renderUploadHistory(uploadHistory);
    } catch (error) {
        console.error('加载上传历史失败', error);
    }
}

function showUploadSuccessModal() {
    const modal = document.getElementById('uploadSuccessModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function hideUploadSuccessModal() {
    const modal = document.getElementById('uploadSuccessModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function setupCapabilityForm() {
    const form = document.getElementById('capabilityForm');
    const resultContainer = document.getElementById('formResult');

    if (!form || !resultContainer) {
        return;
    }

    ['coreProductsList', 'intellectualPropertiesList', 'patentList'].forEach((id) => {
        setupDynamicList(id);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!currentUser || currentUser.role !== 'ENTERPRISE') {
            resultContainer.textContent = '请使用企业账号登录后再提交信息。';
            resultContainer.classList.add('visible');
            return;
        }

        const formData = new FormData(form);
        const normalised = normaliseFormData(formData);

        try {
            resultContainer.textContent = '正在提交，请稍候...';
            resultContainer.classList.add('visible');
            const response = await fetch(`${CAPABILITY_API_BASE}/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-Token': currentUser.token,
                },
                body: JSON.stringify(normalised),
            });

            const payload = await response.json();
            if (!response.ok || !payload.success) {
                throw new Error(payload.message || '提交失败，请稍后再试');
            }

            const submission = payload.submission || normalised;
            const { companyName, creditCode, companyScale, companyAddress, companyType, businessIntro, contactName, contactInfo } = submission;

            const summary = `
                <div class="result-summary">
                    <h3>能力信息提交成功</h3>
                    <p>${payload.message || '已提交，等待管理员审核。'}</p>
                    <div class="result-grid">
                        <div><span>统一信用代码</span><strong>${creditCode || '-'}</strong></div>
                        <div><span>企业规模</span><strong>${companyScale || '-'}</strong></div>
                        <div><span>企业类型</span><strong>${companyType || '-'}</strong></div>
                        <div><span>企业地址</span><strong>${companyAddress || '-'}</strong></div>
                        <div><span>联系人</span><strong>${contactName || '-'}</strong></div>
                        <div><span>联系方式</span><strong>${contactInfo || '-'}</strong></div>
                    </div>
                    <div class="result-section">
                        <h4>业务简介</h4>
                        <p>${businessIntro || '—'}</p>
                    </div>
                    ${renderArraySection('核心产品', submission.coreProducts)}
                    ${renderArraySection('知识产权', submission.intellectualProperties)}
                    ${renderArraySection('专利', submission.patents)}
                    <div class="tag pending">当前状态：待审核</div>
                </div>
            `;

            resultContainer.innerHTML = summary;
            resultContainer.classList.add('visible');

            showUploadSuccessModal();
            fetchUploadHistory();
            form.reset();
            ['coreProductsList', 'intellectualPropertiesList', 'patentList'].forEach((id) => resetDynamicList(id));
        } catch (error) {
            resultContainer.textContent = error.message || '提交失败';
            resultContainer.classList.add('visible');
        }
    });

    form.addEventListener('reset', () => {
        setTimeout(() => {
            resultContainer.innerHTML = '';
            resultContainer.classList.remove('visible');
            ['coreProductsList', 'intellectualPropertiesList', 'patentList'].forEach((id) => resetDynamicList(id));
        }, 0);
    });
}

function resetDynamicList(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    const items = container.querySelectorAll('.dynamic-item');
    items.forEach((item, index) => {
        const input = item.querySelector('input');
        if (index === 0) {
            if (input) {
                input.value = '';
            }
        } else {
            item.remove();
        }
    });

    updateRemoveButtons(container);
}

document.addEventListener('DOMContentLoaded', () => {
    const navigationApi = handleNavigation();
    applyRoleVisibility(null, navigationApi);
    setupAuth(navigationApi);
    setupChatPanels();
    setupCapabilityForm();
    renderUploadHistory(uploadHistory);

    const refreshUploadHistoryBtn = document.getElementById('refreshUploadHistory');
    if (refreshUploadHistoryBtn) {
        refreshUploadHistoryBtn.addEventListener('click', () => fetchUploadHistory());
    }

    const closeModalBtn = document.getElementById('closeUploadModal');
    const modalOverlay = document.getElementById('uploadSuccessModal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', hideUploadSuccessModal);
    }
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (event) => {
            if (event.target === modalOverlay) {
                hideUploadSuccessModal();
            }
        });
    }
});