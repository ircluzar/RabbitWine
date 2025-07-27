// modals.js - Reusable modal logic for Rabbit Wine apps
// Usage: Modals.open({ title, content, onConfirm, onCancel, confirmText, cancelText })

window.Modals = (function() {
    let modalEl = null;
    let overlayEl = null;
    let lastActive = null;

    function createModal({ title = '', content = '', onConfirm, onCancel, confirmText = 'OK', cancelText = 'Cancel', showCancel = true, closeOnOverlay = true }) {
        // Remove any existing modal
        closeModal();
        lastActive = document.activeElement;

        overlayEl = document.createElement('div');
        overlayEl.className = 'modal-overlay';
        overlayEl.tabIndex = -1;
        if (closeOnOverlay) {
            overlayEl.onclick = (e) => { if (e.target === overlayEl) closeModal(); };
        }

        modalEl = document.createElement('div');
        modalEl.className = 'modal-box';
        modalEl.innerHTML = `
            <div class="modal-header">${title ? `<span class="modal-title">${title}</span>` : ''}<button class="modal-close" aria-label="Close">×</button></div>
            <div class="modal-content">${typeof content === 'string' ? content : ''}</div>
            <div class="modal-actions">
                ${showCancel ? `<button class="modal-cancel">${cancelText}</button>` : ''}
                <button class="modal-confirm">${confirmText}</button>
            </div>
        `;
        overlayEl.appendChild(modalEl);
        document.body.appendChild(overlayEl);
        document.body.classList.add('modal-open');

        // Insert custom content node if provided
        if (typeof content !== 'string' && content instanceof Node) {
            modalEl.querySelector('.modal-content').innerHTML = '';
            modalEl.querySelector('.modal-content').appendChild(content);
        }

        // Focus management
        setTimeout(() => {
            modalEl.querySelector('.modal-confirm').focus();
        }, 10);

        // Event listeners
        modalEl.querySelector('.modal-close').onclick = closeModal;
        if (showCancel) modalEl.querySelector('.modal-cancel').onclick = () => { closeModal(); if (onCancel) onCancel(); };
        modalEl.querySelector('.modal-confirm').onclick = () => { closeModal(); if (onConfirm) onConfirm(); };

        // Keyboard: ESC closes, Enter confirms
        overlayEl.onkeydown = (e) => {
            if (e.key === 'Escape') { closeModal(); if (onCancel) onCancel(); }
            if (e.key === 'Enter') { closeModal(); if (onConfirm) onConfirm(); }
        };
        overlayEl.focus();
    }

    function closeModal() {
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = null;
        modalEl = null;
        document.body.classList.remove('modal-open');
        if (lastActive) lastActive.focus();
    }


    // Simple message box (alert)
    function alertBox(message, title = 'Message', confirmText = 'OK') {
        return new Promise(resolve => {
            createModal({
                title,
                content: message,
                confirmText,
                showCancel: false,
                onConfirm: resolve
            });
        });
    }

    // Simple confirm box
    function confirmBox(message, title = 'Confirm', confirmText = 'OK', cancelText = 'Cancel') {
        return new Promise(resolve => {
            createModal({
                title,
                content: message,
                confirmText,
                cancelText,
                showCancel: true,
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    }

    // Input box modal
    function inputBox({
        message = '',
        title = 'Input',
        confirmText = 'OK',
        cancelText = 'Cancel',
        placeholder = '',
        defaultValue = '',
        type = 'text',
        validate = null // function(value) => string|undefined for error
    } = {}) {
        return new Promise(resolve => {
            let errorMsg = '';
            const input = document.createElement('input');
            input.type = type;
            input.placeholder = placeholder;
            input.value = defaultValue;
            input.className = 'modal-input';
            input.style = 'width: 100%; margin-top: 12px; font-size: 1.1em; padding: 8px; border-radius: 6px; border: 1px solid #4a4458; background: #23203a; color: #e6e6e6;';

            const error = document.createElement('div');
            error.className = 'modal-input-error';
            error.style = 'color: #ff6b6b; font-size: 0.98em; margin-top: 8px; min-height: 1.2em;';

            const content = document.createElement('div');
            if (message) {
                const msg = document.createElement('div');
                msg.textContent = message;
                msg.style = 'margin-bottom: 6px;';
                content.appendChild(msg);
            }
            content.appendChild(input);
            content.appendChild(error);

            function doConfirm() {
                let val = input.value;
                if (validate) {
                    const err = validate(val);
                    if (err) {
                        error.textContent = err;
                        input.focus();
                        return;
                    }
                }
                closeModal();
                resolve(val);
            }
            function doCancel() {
                closeModal();
                resolve(null);
            }

            createModal({
                title,
                content,
                confirmText,
                cancelText,
                showCancel: true,
                onConfirm: doConfirm,
                onCancel: doCancel
            });
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    doConfirm();
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    doCancel();
                }
            });
            setTimeout(() => input.focus(), 50);
        });
    }

    return {
        open: createModal,
        close: closeModal,
        alert: alertBox,
        confirm: confirmBox,
        inputBox
    };
})();
