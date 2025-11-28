import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Platform, debounce } from 'obsidian';

interface SidebarRule {
	viewType: string;
	leftSidebar: 'expand' | 'collapse' | 'default';
	rightSidebar: 'expand' | 'collapse' | 'default';
}

interface AutoSwitchSettings {
	rules: SidebarRule[];
}

const DEFAULT_SETTINGS: AutoSwitchSettings = {
	rules: []
}

export default class AutoSwitchSidebarPlugin extends Plugin {
	settings: AutoSwitchSettings;
    private rulesMap: Map<string, SidebarRule> = new Map();

	async onload() {
        // 性能优化：仅在桌面端加载，移动端无侧边栏概念
        if (!Platform.isDesktop) return;

		await this.loadSettings();

		this.addSettingTab(new AutoSwitchSettingTab(this.app, this));

        // 性能优化：使用 debounce 防抖，避免快速切换标签页时频繁触发侧边栏动画
        // 100ms 延迟足以区分快速浏览和停留
		this.registerEvent(this.app.workspace.on('active-leaf-change', debounce((leaf) => {
			this.handleActiveLeafChange(leaf);
		}, 100, true)));
	}

    updateRulesMap() {
        this.rulesMap.clear();
        this.settings.rules.forEach(rule => this.rulesMap.set(rule.viewType, rule));
    }

	async handleActiveLeafChange(leaf: WorkspaceLeaf | null) {
		if (!leaf) return;
        // 性能优化：如果没有规则，直接返回，不执行任何查找
        if (this.settings.rules.length === 0) return;

		const viewType = leaf.view.getViewType();
		
        // 性能优化：使用 Map O(1) 查找替代数组遍历
		const rule = this.rulesMap.get(viewType);
		if (rule) {
			this.applySidebarState('left', rule.leftSidebar);
			this.applySidebarState('right', rule.rightSidebar);
		}
	}

	applySidebarState(side: 'left' | 'right', action: 'expand' | 'collapse' | 'default') {
		if (action === 'default') return;
		
		const split = side === 'left' ? (this.app.workspace as any).leftSplit : (this.app.workspace as any).rightSplit;
		if (!split) return;

		if (action === 'expand') {
			if (split.collapsed) {
                if (typeof split.expand === 'function') {
                    split.expand();
                } else {
                    // Fallback command
                    const commandId = side === 'left' ? 'workspace:toggle-left-sidebar' : 'workspace:toggle-right-sidebar';
                    (this.app as any).commands.executeCommandById(commandId);
                }
            }
		} else if (action === 'collapse') {
			if (!split.collapsed) {
                if (typeof split.collapse === 'function') {
                    split.collapse();
                } else {
                    // Fallback command
                    const commandId = side === 'left' ? 'workspace:toggle-left-sidebar' : 'workspace:toggle-right-sidebar';
                    (this.app as any).commands.executeCommandById(commandId);
                }
            }
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.updateRulesMap();
	}

	async saveSettings() {
		await this.saveData(this.settings);
        this.updateRulesMap();
	}
}

class AutoSwitchSettingTab extends PluginSettingTab {
	plugin: AutoSwitchSidebarPlugin;
    newRuleViewType: string = '';

	constructor(app: App, plugin: AutoSwitchSidebarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: '自动切换侧边栏设置' });

        // --- 1. 准备数据 ---
        const allOpenViewTypes = new Set<string>();
        this.app.workspace.iterateRootLeaves(leaf => {
            allOpenViewTypes.add(leaf.view.getViewType());
        });
        const existingRuleTypes = new Set(this.plugin.settings.rules.map(r => r.viewType));
        const availableViewTypes = Array.from(allOpenViewTypes).filter(vt => !existingRuleTypes.has(vt));

        const activeLeaf = this.app.workspace.getMostRecentLeaf();
        const currentViewType = activeLeaf?.view.getViewType();
        const isCurrentRuleExist = currentViewType && existingRuleTypes.has(currentViewType);

        // --- 2. 添加规则区域 (整合了输入框和可用ID列表) ---
        containerEl.createEl('h3', { text: '添加新规则' });
        const addSection = containerEl.createDiv({ cls: 'auto-switch-add-section' });

        const addRuleSetting = new Setting(addSection)
            .setName('视图 ID')
            .setDesc('输入插件视图的 ID (例如 "thino_view")');

        addRuleSetting
            .addText(text => text
                .setPlaceholder('视图 ID')
                .setValue(this.newRuleViewType)
                .onChange(async (value) => {
                    this.newRuleViewType = value;
                }));

        // 智能按钮逻辑
        if (currentViewType) {
            const btnText = isCurrentRuleExist ? '活跃视图ID已存在' : '填入当前ID';
            const btnTooltip = isCurrentRuleExist 
                ? `当前活跃视图 "${currentViewType}" 已在规则列表中` 
                : `使用当前活跃窗口的视图ID: "${currentViewType}"`;

            addRuleSetting.addButton(btn => {
                btn.setButtonText(btnText)
                   .setTooltip(btnTooltip);
                
                if (isCurrentRuleExist) {
                    btn.setDisabled(true);
                } else {
                    btn.onClick(() => {
                        this.newRuleViewType = currentViewType;
                        this.display();
                    });
                }
            });
        }

        addRuleSetting.addButton(btn => btn
                .setButtonText('添加')
                .setCta()
                .onClick(async () => {
                    if (this.newRuleViewType) {
                        if (this.plugin.settings.rules.some(r => r.viewType === this.newRuleViewType)) {
                            return;
                        }

                        this.plugin.settings.rules.push({
                            viewType: this.newRuleViewType,
                            leftSidebar: 'default',
                            rightSidebar: 'default'
                        });
                        await this.plugin.saveSettings();
                        this.newRuleViewType = '';
                        this.display();
                    }
                }));

        // 可用 ID 列表 (作为添加区域的一部分)
        if (availableViewTypes.length > 0) {
            const chipsContainer = addSection.createDiv({ cls: 'auto-switch-chips-container' });
            chipsContainer.createEl('span', { text: '检测到未设置规则的视图 (点击填入):', cls: 'auto-switch-chips-label' });
            const chipsList = chipsContainer.createDiv({ cls: 'auto-switch-chips-list' });
            
            availableViewTypes.forEach(vt => {
                const chip = chipsList.createEl('span', { cls: 'auto-switch-chip', text: vt });
                chip.onclick = () => {
                    this.newRuleViewType = vt;
                    this.display(); 
                };
            });
        }

		containerEl.createEl('h3', { text: '已存规则 (拖动可排序)' });

        const rulesContainer = containerEl.createDiv({ cls: 'auto-switch-rules-container' });

		this.plugin.settings.rules.forEach((rule, index) => {
			const card = rulesContainer.createDiv({ cls: 'auto-switch-rule-card' });
            card.setAttribute('draggable', 'true');
            // Store original index to map back to settings
            card.dataset.index = index.toString();

            // --- Drag & Drop Logic ---
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData('text/plain', index.toString());
                setTimeout(() => card.classList.add('sortable-ghost'), 0);
            });

            card.addEventListener('dragend', async () => {
                card.classList.remove('sortable-ghost');
                
                // Reconstruct settings based on new DOM order
                const newRules: SidebarRule[] = [];
                const cards = rulesContainer.querySelectorAll('.auto-switch-rule-card');
                cards.forEach(c => {
                    const originalIndex = parseInt((c as HTMLElement).dataset.index!);
                    if (!isNaN(originalIndex) && this.plugin.settings.rules[originalIndex]) {
                        newRules.push(this.plugin.settings.rules[originalIndex]);
                    }
                });
                
                this.plugin.settings.rules = newRules;
                await this.plugin.saveSettings();
                // Re-render to update indices
                this.display();
            });

            card.addEventListener('dragover', (e) => {
                e.preventDefault(); // Allow drop
            });

            card.addEventListener('dragenter', (e) => {
                e.preventDefault();
                const draggingCard = rulesContainer.querySelector('.sortable-ghost') as HTMLElement;
                if (draggingCard && draggingCard !== card) {
                    const cards = Array.from(rulesContainer.children);
                    const draggingIndex = cards.indexOf(draggingCard);
                    const targetIndex = cards.indexOf(card);
                    
                    if (draggingIndex < targetIndex) {
                        rulesContainer.insertBefore(draggingCard, card.nextSibling);
                    } else {
                        rulesContainer.insertBefore(draggingCard, card);
                    }
                }
            });
            // -------------------------
            
            const header = card.createDiv({ cls: 'auto-switch-rule-header' });
            const title = header.createSpan({ cls: 'view-type-tag', text: rule.viewType });
            
            const deleteBtn = header.createEl('button', { cls: 'auto-switch-delete-btn', text: '✕' });
            deleteBtn.setAttribute('aria-label', '删除规则');
            deleteBtn.onclick = async (e) => {
                e.stopPropagation(); // Prevent drag start if clicking delete
                this.plugin.settings.rules.splice(index, 1);
                await this.plugin.saveSettings();
                this.display();
            };

            new Setting(card)
                .setName('左侧边栏')
                .addDropdown(dropdown => dropdown
                    .addOption('default', '保持原样')
                    .addOption('expand', '展开')
                    .addOption('collapse', '收起')
                    .setValue(rule.leftSidebar)
                    .onChange(async (value) => {
                        rule.leftSidebar = value as any;
                        await this.plugin.saveSettings();
                    }));

            new Setting(card)
                .setName('右侧边栏')
                .addDropdown(dropdown => dropdown
                    .addOption('default', '保持原样')
                    .addOption('expand', '展开')
                    .addOption('collapse', '收起')
                    .setValue(rule.rightSidebar)
                    .onChange(async (value) => {
                        rule.rightSidebar = value as any;
                        await this.plugin.saveSettings();
                    }));
		});
	}
}

