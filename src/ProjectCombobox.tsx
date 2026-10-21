import { useCallback, useId, useMemo, useRef, useState } from 'react'

export type ProjectRow = { id: number; name: string }

type Props = {
  projects: ProjectRow[]
  projectId: number | ''
  setProjectId: (id: number | '') => void
}

export default function ProjectCombobox({
  projects,
  projectId,
  setProjectId,
}: Props) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)

  const selectedName = useMemo(() => {
    if (projectId === '') return ''
    return projects.find((p) => p.id === projectId)?.name ?? ''
  }, [projects, projectId])

  /** Shown when menu is closed and no project is selected (empty string is easy to miss). */
  const closedDisplay = projectId === '' ? 'No project' : selectedName

  const inputValue = open ? query : closedDisplay

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.name.toLowerCase().includes(q))
  }, [projects, query])

  const options = useMemo(
    () =>
      [{ type: 'none' as const }, ...filtered.map((p) => ({ type: 'project' as const, ...p }))],
    [filtered],
  )

  const safeHighlight = Math.min(
    Math.max(0, highlightIndex),
    Math.max(0, options.length - 1),
  )

  const commitIndex = useCallback(
    (index: number) => {
      const item = options[index]
      if (!item) return
      if (item.type === 'none') {
        setProjectId('')
      } else {
        setProjectId(item.id)
      }
      setOpen(false)
      setHighlightIndex(0)
      inputRef.current?.blur()
    },
    [options, setProjectId],
  )

  const restoreAndClose = useCallback(() => {
    setOpen(false)
    setHighlightIndex(0)
  }, [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setOpen(true)
    setHighlightIndex(0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlightIndex((i) => Math.min(i + 1, options.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setHighlightIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open) commitIndex(safeHighlight)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      restoreAndClose()
      inputRef.current?.blur()
    }
  }

  /** `onFocus` alone misses the common case: after committing a choice the input keeps
   *  focus, so the next click fires no focus event and the list never reopens. */
  const openMenu = useCallback(() => {
    setOpen(true)
    setQuery(projectId === '' ? '' : selectedName)
    setHighlightIndex(0)
  }, [projectId, selectedName])

  const onBlur = () => {
    window.setTimeout(() => {
      restoreAndClose()
    }, 0)
  }

  return (
    <div className="project-combobox">
      <input
        ref={inputRef}
        type="text"
        className="project-combobox-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-opt-${safeHighlight}` : undefined}
        autoComplete="off"
        value={inputValue}
        onChange={onInputChange}
        onKeyDown={onKeyDown}
        onFocus={openMenu}
        onClick={() => {
          if (!open) openMenu()
        }}
        onBlur={onBlur}
        placeholder="Search projects…"
      />
      {open && (
        <div
          id={listId}
          className="project-combobox-list"
          role="listbox"
        >
          {options.map((item, idx) => {
            const active = idx === safeHighlight
            const id = `${listId}-opt-${idx}`
            if (item.type === 'none') {
              return (
                <button
                  key="none"
                  type="button"
                  id={id}
                  role="option"
                  aria-selected={projectId === ''}
                  className={
                    active
                      ? 'project-combobox-option project-combobox-option--active'
                      : 'project-combobox-option'
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onClick={() => commitIndex(idx)}
                >
                  No project
                </button>
              )
            }
            return (
              <button
                key={item.id}
                type="button"
                id={id}
                role="option"
                aria-selected={projectId === item.id}
                className={
                  active
                    ? 'project-combobox-option project-combobox-option--active'
                    : 'project-combobox-option'
                }
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlightIndex(idx)}
                onClick={() => commitIndex(idx)}
              >
                {item.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
