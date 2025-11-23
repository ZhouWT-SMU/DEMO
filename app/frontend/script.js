const moduleTitle = document.getElementById('moduleTitle');
const moduleDescription = document.getElementById('moduleDescription');

const API_BASE_URL = '/api/chat';
const STORAGE_KEYS = {
    userId: 'enterpriseChatUserId',
    conversationPrefix: 'enterpriseChatConversation:',
};

const panelStates = new WeakMap();
let cachedUserId = null;

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
        isLoading: false,
    };

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
}

function handleNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const modules = document.querySelectorAll('.module');

    menuItems.forEach((item) => {
        item.addEventListener('click', () => {
            if (item.classList.contains('active')) {
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
        });
    });
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
    history.scrollTop = history.scrollHeight;

    return { element: message, body };
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

        const labels = {
            user: panel.dataset.userLabel || '我',
            assistant: panel.dataset.assistantLabel || '智能助手',
        };

        const replyTemplate = panel.dataset.replyTemplate
            || '已记录您的需求“{message}”。我们将结合企业画像为您准备相应的服务建议。';

        const panelState = getPanelState(panel);
        const defaultSendLabel = sendButton.textContent;

        const sendCurrentMessage = async () => {
            const text = input.value.trim();
            if (!text || panelState.isLoading) {
                return;
            }

            appendMessage(history, 'user', text, labels);
            input.value = '';
            input.focus();

            panelState.isLoading = true;
            sendButton.disabled = true;
            sendButton.textContent = '发送中…';

            const pending = appendMessage(history, 'assistant', '正在生成回复…', labels, { pending: true });
            const payload = {
                message: text,
                userId: getUserId(),
            };

            if (panelState.conversationId) {
                payload.conversationId = panelState.conversationId;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/send-stream`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                const data = await response.json();

                if (!response.ok || data.success === false) {
                    const errorMessage = data && data.error ? data.error : `请求失败，状态码 ${response.status}`;
                    throw new Error(errorMessage);
                }

                const answer = (data.answer || '').trim();
                renderAssistantMessage(pending.body, answer || '对话已完成。');
                pending.element.classList.remove('pending');

                if (data.conversationId) {
                    persistConversationId(panelState, data.conversationId);
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
                history.scrollTop = history.scrollHeight;
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

function setupCapabilityForm() {
    const form = document.getElementById('capabilityForm');
    const resultContainer = document.getElementById('formResult');

    if (!form || !resultContainer) {
        return;
    }

    ['coreProductsList', 'intellectualPropertiesList', 'patentList'].forEach((id) => {
        setupDynamicList(id);
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const normalised = normaliseFormData(formData);

        const { companyName, creditCode, companyScale, companyAddress, companyType, businessIntro, contactName, contactInfo } = normalised;

        const summary = `
            <div class="result-summary">
                <h3>能力信息提交成功</h3>
                <p>感谢您提交 <strong>${companyName || '未命名企业'}</strong> 的最新能力信息，我们的顾问将尽快与您联系。</p>
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
                ${renderArraySection('核心产品', Array.isArray(normalised.coreProducts) ? normalised.coreProducts : normalised.coreProducts ? [normalised.coreProducts] : [])}
                ${renderArraySection('知识产权', Array.isArray(normalised.intellectualProperties) ? normalised.intellectualProperties : normalised.intellectualProperties ? [normalised.intellectualProperties] : [])}
                ${renderArraySection('专利', Array.isArray(normalised.patents) ? normalised.patents : normalised.patents ? [normalised.patents] : [])}
            </div>
        `;

        resultContainer.innerHTML = summary;
        resultContainer.classList.add('visible');

        form.reset();
        ['coreProductsList', 'intellectualPropertiesList', 'patentList'].forEach((id) => resetDynamicList(id));
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
    handleNavigation();
    setupChatPanels();
    setupCapabilityForm();
});
