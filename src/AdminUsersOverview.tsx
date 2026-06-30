import { useState, useEffect, FormEvent } from 'react';
import { AdminUsersOverviewProps, roleOptions } from './App';
import { Field } from './components/ui/Field';
import { EditUserModal } from './EditUserModal';
import type { UserCreateInput } from './types/admin';
import type { AppRole } from './types/domain';

export function AdminUsersOverview({
  users, departments, currentUserId, savingUserId, onCreateUser, onUpdateUser, onResetUserPassword,
}: AdminUsersOverviewProps) {
  const activeDepartments = departments.filter((department) => department.isActive);
  const defaultDepartmentId = activeDepartments[0]?.id ?? '';
  const [draft, setDraft] = useState<UserCreateInput>({
    username: '',
    displayName: '',
    role: 'CONTROL_ESCOLAR',
    departmentId: defaultDepartmentId || null,
    isActive: true,
    password: '',
  });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  useEffect(() => {
    setDraft((current) => current.departmentId ? current : { ...current, departmentId: defaultDepartmentId || null });
  }, [defaultDepartmentId]);

  const editingUser = users.find((user) => user.id === editingUserId) ?? null;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreateUser({
      ...draft,
      username: draft.username.trim().toLowerCase(),
      displayName: draft.displayName.trim(),
      departmentId: draft.departmentId || null,
    });
    setDraft({
      username: '',
      displayName: '',
      role: 'CONTROL_ESCOLAR',
      departmentId: defaultDepartmentId || null,
      isActive: true,
      password: '',
    });
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetPasswordUserId) return;
    await onResetUserPassword(resetPasswordUserId, resetPassword);
    setResetPasswordUserId(null);
    setResetPassword('');
  }

  return (
    <div className="admin-users-layout">
      <form className="panel sub-panel admin-user-form" onSubmit={handleCreate}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Nuevo usuario</p>
            <h3>Alta de acceso</h3>
          </div>
          <span className="status-tag">Clave temporal</span>
        </div>
        <div className="form-grid compact-form-grid">
          <Field label="Usuario">
            <input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} placeholder="ej. direccion.1" required />
          </Field>
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
              {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </Field>
          <Field label="Contrasena temporal">
            <input minLength={8} type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} required />
          </Field>
          <label className="checkbox-row admin-active-toggle">
            <input checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} type="checkbox" />
            Activo
          </label>
        </div>
        <div className="form-actions">
          <button className="primary-button" disabled={savingUserId === 'new'} type="submit">
            {savingUserId === 'new' ? 'Creando...' : 'Crear usuario'}
          </button>
        </div>
      </form>

      <section className="panel sub-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Usuarios</p>
            <h3>Accesos existentes</h3>
          </div>
          <span className="status-tag">{users.length} usuarios</span>
        </div>
        <div className="student-table-wrap">
          <table className="student-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Departamento</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.displayName}</td>
                  <td>{roleOptions.find((role) => role.value === user.role)?.label ?? user.role}</td>
                  <td>{user.departmentName ?? 'Sin departamento'}</td>
                  <td><span className={user.isActive ? 'status-tag' : 'status-tag status-tag-muted'}>{user.isActive ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div className="button-row">
                      <button className="secondary-button small-button" onClick={() => setEditingUserId(user.id)} type="button">Editar</button>
                      <button className="tertiary-button small-button" onClick={() => setResetPasswordUserId(user.id)} type="button">Restablecer</button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr><td colSpan={6}>No hay usuarios registrados.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {editingUser ? (
        <EditUserModal
          currentUserId={currentUserId}
          departments={activeDepartments}
          isSaving={savingUserId === editingUser.id}
          user={editingUser}
          onClose={() => setEditingUserId(null)}
          onSubmit={onUpdateUser} />
      ) : null}

      {resetPasswordUserId ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <form className="modal-card checklist-modal" onSubmit={handleResetPassword}>
            <div className="section-header">
              <div>
                <p className="eyebrow">Contrasena</p>
                <h2>Restablecer acceso</h2>
              </div>
              <button className="secondary-button small-button" onClick={() => setResetPasswordUserId(null)} type="button">Cerrar</button>
            </div>
            <Field label="Nueva contrasena temporal">
              <input minLength={8} type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required />
            </Field>
            <div className="form-actions">
              <button className="primary-button" disabled={savingUserId === resetPasswordUserId} type="submit">
                {savingUserId === resetPasswordUserId ? 'Guardando...' : 'Restablecer contrasena'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
