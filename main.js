const { Plugin, ItemView, Modal, TFile } = require('obsidian');

const VIEW_TYPE = "task-master-view";
const FOLDER_PATH = "_system/Tasks";

class TaskMasterView extends ItemView {
    constructor(leaf) { super(leaf); }
    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return "Task Master"; }
    getIcon() { return "check-circle"; }

    async onOpen() { 
        this.refresh(); 
        // Auto-refresh when files change
        this.registerEvent(this.app.vault.on("modify", () => this.refresh()));
        this.registerEvent(this.app.vault.on("delete", () => this.refresh()));
    }

    async refresh() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("tm-container");

        container.createDiv({ cls: "tm-header", text: "Task Master" });
        const listEl = container.createDiv({ cls: "tm-list" });

        if (!await this.app.vault.adapter.exists(FOLDER_PATH)) {
            await this.app.vault.createFolder(FOLDER_PATH);
        }

        const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(FOLDER_PATH));
        const tasks = await Promise.all(files.map(async f => {
            const cache = this.app.metadataCache.getFileCache(f);
            return { file: f, fm: cache?.frontmatter || {} };
        }));

        tasks.sort((a, b) => (a.fm.completed === b.fm.completed) ? 0 : a.fm.completed ? 1 : -1);

        tasks.forEach(task => {
            const card = listEl.createDiv({ cls: `tm-task-card ${task.fm.completed ? 'is-completed' : ''}` });
            const row = card.createDiv({ cls: "tm-main-row" });

            const cb = row.createEl("input", { type: "checkbox" });
            cb.checked = task.fm.completed;
            cb.onclick = async (e) => {
                e.stopPropagation();
                await this.app.fileManager.processFrontMatter(task.file, fm => { fm.completed = cb.checked; });
                this.refresh();
            };

            const info = row.createDiv({ cls: "tm-info" });
            info.createEl("span", { cls: "tm-title", text: task.file.basename });
            
            // Sub-task Progress Label
            if (task.fm.subtasks && task.fm.subtasks.length > 0) {
                const doneCount = task.fm.subtasks.filter(s => s.completed).length;
                info.createDiv({ cls: "tm-sub-stat", text: `↳ Sub-tasks: ${doneCount}/${task.fm.subtasks.length}` });
            }

            card.onclick = () => new TaskFormModal(this.app, task, () => this.refresh()).open();
        });

        const fab = container.createDiv({ cls: "tm-fab", text: "+" });
        fab.onclick = () => new TaskFormModal(this.app, null, () => this.refresh()).open();
    }
}

class TaskFormModal extends Modal {
    constructor(app, task, onSave) {
        super(app);
        this.task = task;
        this.onSave = onSave;
        this.subtasks = task?.fm?.subtasks ? [...task.fm.subtasks] : [];
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        const fm = this.task?.fm || {};

        contentEl.createEl("h2", { text: this.task ? "Edit Task" : "New Task" });

        const titleInp = contentEl.createEl("input", { type: "text", placeholder: "Task Name", value: this.task ? this.task.file.basename : "" });
        titleInp.style.width = "100%";

        const descInp = contentEl.createEl("textarea", { placeholder: "Notes..." });
        descInp.style.width = "100%";
        if (this.task) {
            this.app.vault.read(this.task.file).then(c => descInp.value = c.split('---').pop().trim());
        }

        contentEl.createEl("h4", { text: "Details" });
        const grid = contentEl.createDiv({ attr: { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 10px;" } });
        
        const prio = grid.createEl("select");
        ["Low", "Medium", "High"].forEach(p => {
            const o = prio.createEl("option", { text: p, value: p });
            if (fm.priority === p) o.selected = true;
        });

        const dueInp = grid.createEl("input", { type: "date", value: fm.due || "" });
        const locInp = grid.createEl("input", { type: "text", placeholder: "Location", value: fm.location || "" });

        contentEl.createEl("h4", { text: "Sub-tasks" });
        const subList = contentEl.createDiv();
        
        const renderSubTasks = () => {
            subList.empty();
            this.subtasks.forEach((s, i) => {
                const sRow = subList.createDiv({ cls: "tm-subtask-row" });
                const scb = sRow.createEl("input", { type: "checkbox" });
                scb.checked = s.completed;
                scb.onclick = () => s.completed = scb.checked;

                const sinp = sRow.createEl("input", { cls: "tm-subtask-input", type: "text", value: s.text });
                sinp.onchange = () => s.text = sinp.value;

                const del = sRow.createEl("button", { text: "✕" });
                del.onclick = () => { this.subtasks.splice(i, 1); renderSubTasks(); };
            });
            const addSub = subList.createEl("button", { text: "+ Add Sub-task", cls: "mod-cta" });
            addSub.onclick = () => { this.subtasks.push({ text: "", completed: false }); renderSubTasks(); };
        };
        renderSubTasks();

        const footer = contentEl.createDiv({ attr: { style: "margin-top: 20px; display: flex; justify-content: space-between;" } });
        const save = footer.createEl("button", { text: "Save Task", cls: "mod-cta" });
        
        save.onclick = async () => {
            const name = titleInp.value || "Untitled";
            const path = `${FOLDER_PATH}/${name.replace(/[\\/:*?"<>|]/g, '-')}.md`;
            
            const subtaskYaml = this.subtasks.map(s => `  - text: "${s.text}"\n    completed: ${s.completed}`).join('\n');
            const content = `---\ncompleted: ${fm.completed || false}\npriority: ${prio.value}\ndue: ${dueInp.value}\nlocation: "${locInp.value}"\nsubtasks:\n${subtaskYaml}\n---\n\n${descInp.value}`;

            if (this.task) {
                await this.app.vault.modify(this.task.file, content);
                if (this.task.file.basename !== name) await this.app.fileManager.renameFile(this.task.file, path);
            } else {
                await this.app.vault.create(path, content);
            }
            this.onSave();
            this.close();
        };

        if (this.task) {
            const del = footer.createEl("button", { text: "Delete", cls: "mod-warning" });
            del.onclick = async () => { await this.app.vault.delete(this.task.file); this.onSave(); this.close(); };
        }
    }
}

module.exports = class TaskMasterPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE, (leaf) => new TaskMasterView(leaf));
        this.addRibbonIcon("check-circle", "Task Master", () => this.activateView());
    }

    async activateView() {
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            // Force the leaf into the right sidebar
            const rightLeaf = this.app.workspace.getRightLeaf(false);
            await rightLeaf.setViewState({ type: VIEW_TYPE, active: true });
            leaf = rightLeaf;
        }
        this.app.workspace.revealLeaf(leaf);
    }
};