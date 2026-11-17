import { useEffect, useState } from 'react'
import { FolderGit2, FolderOpen } from 'lucide-react'
import type { Project } from '@shared/types'
import { Button, Field, Modal, Toggle, inputCls } from './ui'
import { uid } from '../lib/utils'

export function ProjectModal({
  open,
  initial,
  onClose,
  onSave
}: {
  open: boolean
  initial: Project | null
  onClose: () => void
  onSave: (p: Project) => void
}) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [remoteEnabled, setRemoteEnabled] = useState(false)
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setPath(initial?.path ?? '')
    setRemoteEnabled(initial?.remoteEnabled ?? false)
  }, [open, initial])

  useEffect(() => {
    let alive = true
    setBranch(null)
    if (path) window.api.gitBranch(path).then((b) => alive && setBranch(b))
    return () => {
      alive = false
    }
  }, [path])

  const pick = async () => {
    const dir = await window.api.pickFolder(path || undefined)
    if (dir) {
      setPath(dir)
      if (!name.trim()) setName(dir.split(/[\\/]/).filter(Boolean).pop() ?? '')
    }
  }

  const valid = name.trim() && path.trim()

  const submit = () => {
    if (!valid) return
    onSave({
      id: initial?.id ?? uid(),
      createdAt: initial?.createdAt ?? Date.now(),
      name: name.trim(),
      path: path.trim(),
      remoteEnabled
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar projeto' : 'Novo projeto'}
      icon={<FolderGit2 size={16} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {initial ? 'Salvar' : 'Adicionar projeto'}
          </Button>
        </>
      }
    >
      <Field label="Nome do projeto">
        <input
          autoFocus
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: api-pagamentos"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Field>

      <Field
        label="Pasta"
        hint={
          path ? (
            branch ? (
              <span>
                Repositório git detectado · branch <span className="text-purple">{branch}</span>
              </span>
            ) : (
              'Nenhum repositório git detectado nessa pasta.'
            )
          ) : undefined
        }
      >
        <div className="flex gap-2">
          <input
            className={inputCls + ' font-mono text-xs'}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Selecione a pasta…"
          />
          <Button onClick={pick} className="shrink-0">
            <FolderOpen size={15} /> Procurar
          </Button>
        </div>
      </Field>

      <Toggle
        checked={remoteEnabled}
        onChange={setRemoteEnabled}
        label="Ativar Claude Remote Control quando status for OFF"
        hint="Ao sair do PC, o app abre uma sessão remota do Claude Code nesta pasta."
      />
    </Modal>
  )
}
