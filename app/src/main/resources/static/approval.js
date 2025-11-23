const AUTH_URL = '/api/auth/login';
const CAPABILITY_API_BASE = '/api/capability';

let currentUser = null;
let submissionCache = [];

function updateUserStatus(statusText) {
    const statusEl = document.getElementById('userStatus');
    if (statusEl) {
        statusEl.textContent = statusText || '请先登录';
    }
}

function setBanner(message, isError = false) {
    const banner = document.getElementById('approvalMessage');
    if (!banner) {
        return;
    }
    banner.textContent = message || '';
    banner.classList.toggle('visible', Boolean(message));
    banner.classList.toggle('error', isError);
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

function renderArraySection(title, values) {
    if (!values || values.length === 0) {
        return '';
    }

    const listItems = values.map((entry) => `<li>${entry}</li>`).join('');
    return `
        <div class="result-section">
            <h4>${title}</h4>
            <ul>${listItems}</ul>
        </div>
    `;
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
    const decisionName = submission.decisionByName || submission.decisionBy;
    const decisionReason = submission.decisionReason || submission.decisionRemark;
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
            <div><span>审批人</span><strong>${decisionName || '—'}</strong></div>
            <div><span>审批意见</span><strong>${decisionReason || '—'}</strong></div>
        </div>
        <div class="result-section"><h4>业务简介</h4><p>${submission.businessIntro || '—'}</p></div>
        ${decisionReason ? `<div class="result-section"><h4>审批理由</h4><p>${decisionReason}</p></div>` : ''}
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
        renderApprovalDetail(null);
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
                ${item.decisionByName || item.decisionReason ? `<p class="muted">审批人：${item.decisionByName || item.decisionBy || '—'}${item.decisionReason ? ` · ${item.decisionReason}` : ''}</p>` : ''}
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
        setBanner('审批列表已刷新');
    } catch (error) {
        console.error('加载审批列表失败', error);
        setBanner(error.message || '审批列表加载失败', true);
    }
}

async function decideSubmission(id, action, remark) {
    if (!currentUser || currentUser.role !== 'ADMIN') {
        return;
    }
    await fetch(`${CAPABILITY_API_BASE}/submissions/${id}/decision`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': currentUser.token,
        },
        body: JSON.stringify({ decision: action, remark }),
    });
}

function exportSubmissionsToXlsx() {
    if (!submissionCache.length) {
        setBanner('暂无数据可导出', true);
        return;
    }

    if (typeof XLSX === 'undefined') {
        setBanner('导出组件未加载，请检查网络后重试', true);
        return;
    }

    const rows = submissionCache.map((item) => ({
        企业名称: item.companyName || '',
        统一信用代码: item.creditCode || '',
        企业规模: item.companyScale || '',
        企业类型: item.companyType || '',
        企业地址: item.companyAddress || '',
        联系人: item.contactName || '',
        联系方式: item.contactInfo || '',
        核心产品: (item.coreProducts || []).join('、'),
        知识产权: (item.intellectualProperties || []).join('、'),
        专利: (item.patents || []).join('、'),
        提交人: item.submittedBy || '',
        提交时间: formatDateTime(item.createdAt),
        状态: formatStatus(item.status).text,
        审批人: item.decisionByName || item.decisionBy || '',
        审批时间: formatDateTime(item.decisionAt),
        审批理由: item.decisionReason || item.decisionRemark || '',
        处理备注: item.decisionRemark || '',
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '能力企业列表');
    XLSX.writeFile(workbook, `能力企业列表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setBanner('已导出能力企业列表');
}

function setupApprovalModule() {
    const listEl = document.getElementById('approvalList');
    const refreshBtn = document.getElementById('refreshSubmissions');
    const exportBtn = document.getElementById('exportSubmissions');

    if (listEl) {
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
                setBanner('请先使用管理员账号登录', true);
                return;
            }

            const reason = window.prompt(`请输入${action === 'approve' ? '同意' : '拒绝'}理由`);
            if (reason === null) {
                return;
            }
            const trimmed = reason.trim();
            if (!trimmed) {
                setBanner('审批理由不能为空', true);
                return;
            }

            try {
                await decideSubmission(id, action, trimmed);
                await fetchSubmissions();
                const updated = submissionCache.find((entry) => entry.id === id);
                if (updated) {
                    renderApprovalDetail(updated);
                }
                setBanner(action === 'approve' ? '审批已同意' : '审批已拒绝');
            } catch (error) {
                console.error('审批失败', error);
                setBanner('审批失败，请稍后重试', true);
            }
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => fetchSubmissions());
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', exportSubmissionsToXlsx);
    }
}

function setupAuth() {
    const overlay = document.getElementById('authOverlay');
    const form = document.getElementById('loginForm');
    const messageEl = document.getElementById('loginMessage');

    if (!form) {
        return;
    }

    const setSession = (session) => {
        if (session.role !== 'ADMIN') {
            messageEl.textContent = '仅管理员可登录审批中心，请使用管理员账号。';
            messageEl.classList.add('visible');
            return;
        }

        currentUser = session;
        updateUserStatus(`${session.displayName || session.username}（${session.username}）`);

        if (overlay) {
            overlay.classList.add('hidden');
        }

        fetchSubmissions();
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

function init() {
    setupAuth();
    setupApprovalModule();
}

document.addEventListener('DOMContentLoaded', init);
