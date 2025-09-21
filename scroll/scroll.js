// Scroll Todo App - Main Logic (Optimized & Cleaned)
// Uses memory.js for centralized data storage

const SCROLL_NAMESPACE = 'Scroll';
const MEMORY_KEYS = {
    activeTasks: 'activeTasks',
    completedTasks: 'completedTasks',
    editMode: 'editMode',
    completedTasksVisible: 'completedTasksVisible'
};

let activeTasks = [];
let completedTasks = [];
let editMode = false;
let completedTasksVisible = false;
let expirationTimer = null;

function saveToMemory() {
    try {
        memory.write(SCROLL_NAMESPACE, MEMORY_KEYS.activeTasks, activeTasks);
        memory.write(SCROLL_NAMESPACE, MEMORY_KEYS.completedTasks, completedTasks);
        memory.write(SCROLL_NAMESPACE, MEMORY_KEYS.editMode, editMode);
        memory.write(SCROLL_NAMESPACE, MEMORY_KEYS.completedTasksVisible, completedTasksVisible);
    } catch (e) {
        console.warn('Failed to save to memory:', e);
    }
}

function loadFromMemory() {
    try {
        // Check if data exists in memory.js
        activeTasks = memory.read(SCROLL_NAMESPACE, MEMORY_KEYS.activeTasks);
        completedTasks = memory.read(SCROLL_NAMESPACE, MEMORY_KEYS.completedTasks);
        editMode = memory.read(SCROLL_NAMESPACE, MEMORY_KEYS.editMode);
        completedTasksVisible = memory.read(SCROLL_NAMESPACE, MEMORY_KEYS.completedTasksVisible);

        // If no data in memory.js, try to migrate from old localStorage
        if (!activeTasks && !completedTasks) {
            try {
                const oldActiveTasks = JSON.parse(localStorage.getItem('scroll_active_tasks') || '[]');
                const oldCompletedTasks = JSON.parse(localStorage.getItem('scroll_completed_tasks') || '[]');
                const oldState = JSON.parse(localStorage.getItem('scroll_app_state') || '{}');
                if (oldActiveTasks.length > 0 || oldCompletedTasks.length > 0) {
                    activeTasks = oldActiveTasks;
                    completedTasks = oldCompletedTasks;
                    editMode = oldState.editMode || false;
                    completedTasksVisible = oldState.completedTasksVisible || false;
                    saveToMemory();
                }
            } catch (migrationError) {
                console.warn('Failed to migrate from localStorage:', migrationError);
            }
        }

        // Use data from memory.js or set defaults
        activeTasks = Array.isArray(activeTasks) ? activeTasks : [];
        completedTasks = Array.isArray(completedTasks) ? completedTasks : [];
        editMode = typeof editMode === 'boolean' ? editMode : false;
        completedTasksVisible = typeof completedTasksVisible === 'boolean' ? completedTasksVisible : false;
    } catch (e) {
        console.warn('Failed to load from memory:', e);
        // Fallback to defaults
        activeTasks = [];
        completedTasks = [];
        editMode = false;
        completedTasksVisible = false;
    }
}

function renderActiveTasks() {
    const $list = $('#tasksList').empty();
    if (!activeTasks.length) {
        $('#emptyState').show();
        return;
    }
    $('#emptyState').hide();
    for (const task of activeTasks) {
        const $li = $('<li>').addClass('task-item').attr('data-task-id', task.id);
        if (task.checked) $li.addClass('checked');
        if (editMode) $li.attr('draggable', 'true');
        // Custom checkbox with aria-label for accessibility
        const $checkbox = $('<input type="checkbox">').prop('checked', !!task.checked).attr('aria-label', task.checked ? 'Mark as not done' : 'Mark as done').on('change', () => toggleTaskChecked(task.id));
        // Preserve newlines by replacing with <br>
        const $text = $('<span class="task-text">').html(task.text.replace(/\n/g, '<br>'));
        const $deleteBtn = $('<button class="delete-btn" title="Delete">🗑️</button>').on('click', () => deleteTask(task.id));
        // Add fast-complete button in edit mode
        if (editMode && !task.checked) {
            const $completeBtn = $('<button class="complete-btn" title="Complete + Archive">✔️</button>').on('click', () => {
                task.checked = true;
                task.checkedAt = Date.now();
                task.expireAfterMs = 5000;
                renderActiveTasks();
                saveToMemory();
            });
            $li.append($checkbox, $text, $deleteBtn, $completeBtn);
        } else {
            $li.append($checkbox, $text, $deleteBtn);
        }
        $list.append($li);
    }
    if (editMode) enableDragAndDrop();
}

function renderCompletedTasks() {
    const $list = $('#completedList').empty();
    if (!completedTasks.length) {
        $list.append($('<li class="empty-state">No completed tasks</li>'));
        return;
    }
    for (const task of completedTasks) {
        const $li = $('<li>').addClass('task-item').attr('data-task-id', task.id);
        $li.append(
            $('<input type="checkbox" disabled>').prop('checked', true).attr('aria-label', 'Completed'),
            $('<span class="task-text">').html(task.text.replace(/\n/g, '<br>')),
            $('<button class="restore-btn" title="Restore">↩️</button>').on('click', () => restoreTask(task.id))
        );
        if (editMode) {
            const $deleteBtn = $('<button class="delete-btn" title="Delete">🗑️</button>').on('click', () => deleteCompletedTask(task.id));
            $li.append($deleteBtn);
            $li.attr('draggable', 'true');
        }
        $list.append($li);
    }
    if (editMode) enableCompletedDragAndDrop();
}

// Permanently delete a completed (archived) task
function deleteCompletedTask(taskId) {
    window.Modals.confirm('Delete this completed task permanently?', 'Delete Completed Task', 'Delete', 'Cancel').then(confirmed => {
        if (!confirmed) return;
        const idx = completedTasks.findIndex(t => t.id === taskId);
        if (idx !== -1) {
            completedTasks.splice(idx, 1);
            renderCompletedTasks();
            saveToMemory();
        }
    });
}
// Drag-and-drop for completed (archived) tasks
function enableCompletedDragAndDrop() {
    let draggedId = null;
    const $items = $('#completedList .task-item');
    $items.off('dragstart dragend dragover dragleave drop');
    $('#completedList').off('dragover drop', '.drag-placeholder');

    $items.on('dragstart', function() {
        draggedId = $(this).data('task-id');
        $(this).addClass('dragging');
    });
    $items.on('dragend', function() {
        draggedId = null;
        $('.drag-placeholder').remove();
        $(this).removeClass('dragging');
    });
    $items.on('dragover', function(e) {
        e.preventDefault();
        if ($(this).hasClass('dragging')) return;
        const $this = $(this);
        const isLast = $this.is($('#completedList .task-item:not(.drag-placeholder)').last());
        const rect = this.getBoundingClientRect();
        const y = e.originalEvent ? e.originalEvent.clientY : 0;
        if (isLast) {
            const extra = rect.height;
            if (y > rect.bottom && y < rect.bottom + extra) {
                if (!$this.next().hasClass('drag-placeholder')) {
                    $('.drag-placeholder').remove();
                    $this.after('<li class="task-item drag-placeholder"></li>');
                }
                return;
            }
            if (y > rect.top + rect.height / 2) {
                if (!$this.next().hasClass('drag-placeholder')) {
                    $('.drag-placeholder').remove();
                    $this.after('<li class="task-item drag-placeholder"></li>');
                }
                return;
            }
        }
        if ($this.prev().hasClass('drag-placeholder')) return;
        $('.drag-placeholder').remove();
        $this.before('<li class="task-item drag-placeholder"></li>');
    });
    $('#completedList').off('dragover', '.drag-placeholder-end');
    $('#completedList').on('dragover', function(e) {
        if ($(e.target).is('.task-item, .drag-placeholder')) return;
        if ($('#completedList .drag-placeholder').length) return;
        if ($('.task-item.dragging', this).length) {
            const $list = $('#completedList');
            const $last = $list.children('.task-item:not(.drag-placeholder)').last();
            if ($last.length) {
                const lastRect = $last[0].getBoundingClientRect();
                if (e.originalEvent && e.originalEvent.clientY > lastRect.bottom) {
                    $list.append('<li class="task-item drag-placeholder"></li>');
                }
            } else {
                $list.append('<li class="task-item drag-placeholder"></li>');
            }
        }
    });
    $('#completedList').on('dragleave', function(e) {
        if (e.target === this) {
            $('.drag-placeholder').remove();
        }
    });
    $('#completedList').on('dragover', '.drag-placeholder', function(e) {
        e.preventDefault();
    });
    $('#completedList').on('drop', '.drag-placeholder', function(e) {
        e.preventDefault();
        if (!draggedId) return;
        const $placeholder = $(this);
        let toIdx = 0;
        $placeholder.prevAll('.task-item').each(function() { toIdx++; });
        $placeholder.remove();
        $('#completedList .task-item').removeClass('dragging');
        reorderCompletedTasksByIndex(draggedId, toIdx);
    });
    $items.on('drop', function(e) {
        e.preventDefault();
        const $placeholder = $('#completedList .drag-placeholder');
        if ($placeholder.length) {
            let toIdx = 0;
            $placeholder.prevAll('.task-item').each(function() { toIdx++; });
            $placeholder.remove();
            $('.task-item').removeClass('dragging');
            reorderCompletedTasksByIndex(draggedId, toIdx);
        } else {
            const targetId = $(this).data('task-id');
            $('.drag-placeholder').remove();
            $('.task-item').removeClass('dragging');
            reorderCompletedTasks(draggedId, targetId);
        }
    });
}

// Helper: move draggedId to a specific index in completedTasks
function reorderCompletedTasksByIndex(draggedId, toIdx) {
    if (!draggedId || typeof toIdx !== 'number' || toIdx < 0) return;
    const fromIdx = completedTasks.findIndex(t => t.id === draggedId);
    if (fromIdx === -1) return;
    const [task] = completedTasks.splice(fromIdx, 1);
    if (fromIdx < toIdx && toIdx < completedTasks.length + 1) toIdx--;
    completedTasks.splice(toIdx, 0, task);
    renderCompletedTasks();
    saveToMemory();
}

function reorderCompletedTasks(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const fromIdx = completedTasks.findIndex(t => t.id === draggedId);
    const toIdx = completedTasks.findIndex(t => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [task] = completedTasks.splice(fromIdx, 1);
    completedTasks.splice(toIdx, 0, task);
    renderCompletedTasks();
    saveToMemory();
}

function addTask() {
    const $input = $('#taskInput');
    const text = $input.val().trim();
    if (!text) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    activeTasks.unshift({id, text, checked: false, checkedAt: Date.now(), expireAfterMs: null, createdAt: Date.now()});
    $input.val('');
    $input[0].style.height = 'auto'; // Reset height after adding
    renderActiveTasks();
    saveToMemory();
    $input.focus();
}

function toggleTaskChecked(taskId) {
    const task = activeTasks.find(t => t.id === taskId);
    if (!task) return;
    task.checked = !task.checked;
    task.checkedAt = task.checked ? Date.now() : null;
    if (!task.checked) delete task.expireAfterMs;
    renderActiveTasks();
    saveToMemory();
}

function checkExpiredTasks() {
    const now = Date.now();
    let changed = false;
    for (let i = activeTasks.length - 1; i >= 0; i--) {
        const t = activeTasks[i];
        if (t.checked && t.checkedAt) {
            const expireMs = t.expireAfterMs || 30 * 60 * 1000;
            if (now - t.checkedAt > expireMs) {
                // Move to completedTasks, but ensure no duplicate IDs
                if (!completedTasks.some(ct => ct.id === t.id)) {
                    const completedTask = { ...t, completedAt: now, checked: true };
                    completedTasks.unshift(completedTask);
                    if (completedTasks.length > 50) completedTasks.pop();
                }
                activeTasks.splice(i, 1);
                changed = true;
            }
        }
    }
    if (changed) {
        renderActiveTasks();
        renderCompletedTasks();
        saveToMemory();
    }
}

function showCompletedSection(show) {
    completedTasksVisible = show;
    $('#completedSection').toggleClass('show', show).toggleClass('hide', !show);
    // Change emoji to indicate state
    $('#showCompletedBtn').html(show ? '🚫' : '✅');
    saveToMemory();
}

function restoreTask(taskId) {
    const idx = completedTasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    const t = completedTasks.splice(idx, 1)[0];
    activeTasks.unshift({...t, checked: false, checkedAt: null, completedAt: null});
    renderActiveTasks();
    renderCompletedTasks();
    saveToMemory();
}

function toggleEditMode() {
    editMode = !editMode;
    $('#editModeBtn').html(editMode ? '🛠️' : '✏️');
    $('.scroll-main').toggleClass('edit-mode', editMode);
    renderActiveTasks();
    saveToMemory();
}

function deleteTask(taskId) {
    window.Modals.confirm('Delete this task permanently?', 'Delete Task', 'Delete', 'Cancel').then(confirmed => {
        if (!confirmed) return;
        const idx = activeTasks.findIndex(t => t.id === taskId);
        if (idx !== -1) {
            activeTasks.splice(idx, 1);
            renderActiveTasks();
            saveToMemory();
        }
    });
}

function enableDragAndDrop() {
    let draggedId = null;
    const $items = $('#tasksList .task-item');
    $items.off('dragstart dragend dragover dragleave drop');
    // Remove previous placeholder drop handler
    $('#tasksList').off('dragover drop', '.drag-placeholder');

    $items.on('dragstart', function() {
        draggedId = $(this).data('task-id');
        $(this).addClass('dragging');
    });
    $items.on('dragend', function() {
        draggedId = null;
        $('.drag-placeholder').remove();
        $(this).removeClass('dragging');
    });
    $items.on('dragover', function(e) {
        e.preventDefault();
        if ($(this).hasClass('dragging')) return;
        const $this = $(this);
        const isLast = $this.is($('#tasksList .task-item:not(.drag-placeholder)').last());
        const rect = this.getBoundingClientRect();
        const y = e.originalEvent ? e.originalEvent.clientY : 0;
        // If over the lower region (height of an extra item) below the last item, show placeholder after it
        if (isLast) {
            // Estimate item height (use this item's height)
            const extra = rect.height;
            if (y > rect.bottom && y < rect.bottom + extra) {
                if (!$this.next().hasClass('drag-placeholder')) {
                    $('.drag-placeholder').remove();
                    $this.after('<li class="task-item drag-placeholder"></li>');
                }
                return;
            }
            // Also allow the lower half of the last item for convenience
            if (y > rect.top + rect.height / 2) {
                if (!$this.next().hasClass('drag-placeholder')) {
                    $('.drag-placeholder').remove();
                    $this.after('<li class="task-item drag-placeholder"></li>');
                }
                return;
            }
        }
        // Only insert if not already present and not immediately before this item
        if ($this.prev().hasClass('drag-placeholder')) return;
        $('.drag-placeholder').remove();
        $this.before('<li class="task-item drag-placeholder"></li>');
    });
    // Allow dropping at the end of the list, but only when dragging over the empty area after the last item
    $('#tasksList').off('dragover', '.drag-placeholder-end');
    $('#tasksList').on('dragover', function(e) {
        // Only if dragging and not over a task-item or placeholder
        if ($(e.target).is('.task-item, .drag-placeholder')) return;
        if ($('#tasksList .drag-placeholder').length) return;
        // Only show placeholder at end if a drag is in progress and pointer is below the last item
        if ($('.task-item.dragging').length) {
            const $list = $('#tasksList');
            const $last = $list.children('.task-item:not(.drag-placeholder)').last();
            if ($last.length) {
                const lastRect = $last[0].getBoundingClientRect();
                // Only append placeholder if pointer is below the last item
                if (e.originalEvent && e.originalEvent.clientY > lastRect.bottom) {
                    $list.append('<li class="task-item drag-placeholder"></li>');
                }
            } else {
                // If no items, allow placeholder at end
                $list.append('<li class="task-item drag-placeholder"></li>');
            }
        }
    });
    // Remove placeholder if leaving the list area
    $('#tasksList').on('dragleave', function(e) {
        // Only remove if leaving the list entirely
        if (e.target === this) {
            $('.drag-placeholder').remove();
        }
    });
    // Prevent flicker when dragging over the placeholder itself
    $('#tasksList').on('dragover', '.drag-placeholder', function(e) {
        e.preventDefault();
    });
    // Handle drop on placeholder: move dragged item to placeholder position
    $('#tasksList').on('drop', '.drag-placeholder', function(e) {
        e.preventDefault();
        if (!draggedId) return;
        const $placeholder = $(this);
        // Find the index the placeholder would be if only .task-item were present (excluding the placeholder itself)
        let toIdx = 0;
        $placeholder.prevAll('.task-item').each(function() { toIdx++; });
        // Remove the placeholder before reordering
        $placeholder.remove();
        // Remove dragging class
        $('#tasksList .task-item').removeClass('dragging');
        reorderTasksByIndex(draggedId, toIdx);
    });
    // Also handle drop on task-item (fallback): always use placeholder's position if present
    $items.on('drop', function(e) {
        e.preventDefault();
        const $placeholder = $('#tasksList .drag-placeholder');
        if ($placeholder.length) {
            let toIdx = 0;
            $placeholder.prevAll('.task-item').each(function() { toIdx++; });
            $placeholder.remove();
            $('.task-item').removeClass('dragging');
            reorderTasksByIndex(draggedId, toIdx);
        } else {
            // fallback: move to targetId (should rarely happen)
            const targetId = $(this).data('task-id');
            $('.drag-placeholder').remove();
            $('.task-item').removeClass('dragging');
            reorderTasks(draggedId, targetId);
        }
    });
}

// Helper: move draggedId to a specific index in activeTasks
function reorderTasksByIndex(draggedId, toIdx) {
    if (!draggedId || typeof toIdx !== 'number' || toIdx < 0) return;
    const fromIdx = activeTasks.findIndex(t => t.id === draggedId);
    if (fromIdx === -1) return;
    const [task] = activeTasks.splice(fromIdx, 1);
    // If dragging down, and removing before inserting, adjust index, but only if not dropping at the end
    if (fromIdx < toIdx && toIdx < activeTasks.length + 1) toIdx--;
    activeTasks.splice(toIdx, 0, task);
    renderActiveTasks();
    saveToMemory();
}

function reorderTasks(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const fromIdx = activeTasks.findIndex(t => t.id === draggedId);
    const toIdx = activeTasks.findIndex(t => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [task] = activeTasks.splice(fromIdx, 1);
    activeTasks.splice(toIdx, 0, task);
    renderActiveTasks();
    saveToMemory();
}

function startExpirationTimer() {
    if (expirationTimer) clearInterval(expirationTimer);
    expirationTimer = setInterval(checkExpiredTasks, 2000);
}

function stopExpirationTimer() {
    if (expirationTimer) clearInterval(expirationTimer);
    expirationTimer = null;
}

function initApp() {
    loadFromMemory();
    checkExpiredTasks();
    renderActiveTasks();
    renderCompletedTasks();
    showCompletedSection(completedTasksVisible);
    $('#editModeBtn').html(editMode ? '🛠️' : '✏️');
    $('.scroll-main').toggleClass('edit-mode', editMode);
    startExpirationTimer();
    $('#taskInput').focus();
}

$(function() {
    initApp();
    $('#addTaskBtn').on('click', addTask);
    // Auto-grow textarea
    $('#taskInput').on('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
    // Enter to add (but not shift+enter)
    $('#taskInput').on('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addTask();
        }
    });
    $('#showCompletedBtn').on('click', function() { showCompletedSection(!completedTasksVisible); });
    $('#editModeBtn').on('click', toggleEditMode);
    // No scroll-based show/hide for new button style
    $(window).on('beforeunload', stopExpirationTimer);
});
