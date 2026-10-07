import { useState } from 'react';
import { BookOpen, ChevronRight, FileCode, FileText, Plus, Wand2 } from 'lucide-react';
import type { AgentFile, AgentSkill } from '../lib/agent-workspaces.js';
import { useTranslation } from '../lib/i18n/index.js';

interface NavigationProps {
  selectedPath: string;
  disabled: boolean;
  onSelect: (path: string) => void;
}

/** A file inside a skill, named by its path below the skill folder (or below `scripts/` for a script). */
function SkillFileLink({ file, base, icon: Icon, ...navigation }: NavigationProps & { file: AgentFile; base: string; icon: typeof FileText; }) {
  return (
    <li>
      <button type='button' className='agent-file sidebar-link' disabled={navigation.disabled} aria-current={navigation.selectedPath === file.path ? 'page' : undefined} title={file.path} onClick={() => navigation.onSelect(file.path)}>
        <Icon aria-hidden='true' />
        <span>{file.path.slice(base.length + 1)}</span>
      </button>
    </li>
  );
}

/** A labelled group of a skill's files, with its add action; hidden when it has neither. */
function SkillGroup({ label, files, base, icon, addLabel, onAdd, ...navigation }: NavigationProps & { label: string; files: AgentFile[]; base: string; icon: typeof FileText; addLabel: string; onAdd?: () => void; }) {
  if (!files.length && !onAdd) return null;
  return (
    <li className='agent-skill-group'>
      <span className='agent-skill-group-label'>{label}</span>
      <ul>
        {files.map(file => <SkillFileLink key={file.path} file={file} base={base} icon={icon} {...navigation} />)}
        {onAdd && (
          <li>
            <button type='button' className='agent-file agent-add sidebar-link' disabled={navigation.disabled} onClick={onAdd}>
              <Plus aria-hidden='true' />
              <span>{addLabel}</span>
            </button>
          </li>
        )}
      </ul>
    </li>
  );
}

function SkillNode({ skill, onAdd, ...navigation }: NavigationProps & { skill: AgentSkill; onAdd?: (skill: AgentSkill, kind: 'reference' | 'script') => void; }) {
  const { t } = useTranslation();
  const containsSelection = navigation.selectedPath.startsWith(`${skill.directory}/`);
  const [expanded, setExpanded] = useState(containsSelection);
  const [selection, setSelection] = useState(navigation.selectedPath);
  // Opening a file of a collapsed skill from elsewhere (the phone picker, a new file) expands it.
  if (selection !== navigation.selectedPath) {
    setSelection(navigation.selectedPath);
    if (containsSelection) setExpanded(true);
  }
  return (
    <li>
      <button type='button' className='agent-folder sidebar-link' aria-expanded={expanded} title={skill.directory} onClick={() => setExpanded(value => !value)}>
        <ChevronRight aria-hidden='true' className={`agent-tree-chevron ${expanded ? 'expanded' : ''}`} />
        <Wand2 aria-hidden='true' />
        <span>{skill.name}</span>
      </button>
      {expanded && (
        <ul>
          {skill.entry && <SkillFileLink file={skill.entry} base={skill.directory} icon={FileText} {...navigation} />}
          <SkillGroup label={t('agent.references')} files={skill.references} base={skill.directory} icon={BookOpen} addLabel={t('agent.addReference')} onAdd={onAdd && (() => onAdd(skill, 'reference'))} {...navigation} />
          <SkillGroup label={t('agent.scripts')} files={skill.scripts} base={`${skill.directory}/scripts`} icon={FileCode} addLabel={t('agent.addScript')} onAdd={onAdd && (() => onAdd(skill, 'script'))} {...navigation} />
        </ul>
      )}
    </li>
  );
}

/** A workspace's skills, each a folder holding its SKILL.md, reference files and scripts. */
export function AgentFileTree({ skills, onAdd, ...navigation }: NavigationProps & { skills: AgentSkill[]; onAdd?: (skill: AgentSkill, kind: 'reference' | 'script') => void; }) {
  return <ul className='agent-file-tree'>{skills.map(skill => <SkillNode key={skill.directory} skill={skill} onAdd={onAdd} {...navigation} />)}</ul>;
}
