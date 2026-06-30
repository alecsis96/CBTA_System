import { useState, useEffect, FormEvent } from 'react';
import { EditUserModalProps, roleOptions } from './App';
import { Field } from './components/ui/Field';
import type { UserUpdateInput } from './types/admin';
import type { AppRole } from './types/domain';

export function EditUserModal({ user, departments, currentUserId, isSaving, onClose, onSubmit }: EditUserModalProps) {
  const [draft, setDraft] = useState<UserUpdateInput>({
    displayName: user.displayName,
    role: user.role,
    departmentId: user.departmentId,
    isActive: user.isActive,
  });
  const isSelf = user.id === currentUserId;

  useEffect(() => {
    setDraft({
      displayName: user.displayName,
      role: user.role,
      departmentId: user.departmentId,
      isActive: user.isActive,
    });
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(user.id, { ...draft, displayName: draft.displayName.trim(), departmentId: draft.departmentId || null });
    onClose();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <form className="modal-card checklist-modal" onSubmit={handleSubmit}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Editar usuario</p>
            <h2>{user.username}</h2>
          </div>
          <button className="secondary-button small-button" onClick={onClose} type="button">Cerrar</button>
        </div>
        <div className="form-grid compact-form-grid">
          <Field label="Nombre visible">
            <input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} required />
          </Field>
          <Field label="Rol">
            <select value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value as AppRole }))}>
              {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </Field>
          <Field label="Departamento">
            <select value={draft.departmentId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, departmentId: event.target.value || null }))}>
              <option value="">Sin departamento</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </Field>
          <label className="checkbox-row admin-active-toggle">
            <input checked={draft.isActive} disabled={isSelf && user.role === 'ADMIN'} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} type="checkbox" />
            Activo
          </label>
        </div>
        {isSelf ? <p className="feedback-banner">Estas editando tu propio usuario. El sistema protege que quede al menos un admin activo.</p> : null}
        <div className="form-actions">
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}
