import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  lerSessaoCliente,
  removerSessaoCliente,
  salvarSessaoCliente,
} from '../../src/infra/local-storage/cliente-session';
import type { SessaoCliente } from '../../src/features/cliente/cliente.types';

const sessionA: SessaoCliente = { token: 'token-a', clienteId: 'cliente-a', nome: 'Cliente A' };
const sessionB: SessaoCliente = { token: 'token-b', clienteId: 'cliente-b', nome: 'Cliente B' };
const oldKey = 'banca-ana-maria:cliente-session:v1';

function visit(slug: string) {
  window.history.replaceState({}, '', `/${slug}/cliente/perfil`);
}

beforeEach(() => {
  localStorage.clear();
  visit('banca-a');
});

afterEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('tenant-scoped customer session storage', () => {
  it('never exposes a session from tenant A when navigating to tenant B', () => {
    salvarSessaoCliente(sessionA);
    expect(lerSessaoCliente()).toEqual(sessionA);
    visit('banca-b');
    expect(lerSessaoCliente()).toBeNull();
    salvarSessaoCliente(sessionB);
    expect(lerSessaoCliente()).toEqual(sessionB);
    visit('banca-a');
    expect(lerSessaoCliente()).toEqual(sessionA);
  });

  it('logs out only the current tenant without deleting another tenant session', () => {
    salvarSessaoCliente(sessionA);
    visit('banca-b');
    salvarSessaoCliente(sessionB);
    removerSessaoCliente();
    expect(lerSessaoCliente()).toBeNull();
    visit('banca-a');
    expect(lerSessaoCliente()).toEqual(sessionA);
  });

  it('never reads the former unscoped Ana Maria session on another tenant', () => {
    localStorage.setItem(oldKey, JSON.stringify(sessionA));
    expect(lerSessaoCliente()).toBeNull();
    visit('banca-b');
    expect(lerSessaoCliente()).toBeNull();
    expect(localStorage.getItem(oldKey)).not.toBeNull();
  });

  it('migrates the original Ana Maria session once without losing it', () => {
    localStorage.setItem(oldKey, JSON.stringify(sessionA));
    visit('banca-ana-maria');
    expect(lerSessaoCliente()).toEqual(sessionA);
    expect(localStorage.getItem(oldKey)).toBeNull();
    expect(localStorage.getItem('banca:cliente-session:v2:banca-ana-maria')).toContain('token-a');
    visit('banca-b');
    expect(lerSessaoCliente()).toBeNull();
    visit('banca-ana-maria');
    expect(lerSessaoCliente()).toEqual(sessionA);
  });

  it('replaces legacy Ana Maria credentials on save, and removes them on logout', () => {
    visit('banca-ana-maria');
    localStorage.setItem(oldKey, JSON.stringify(sessionA));
    salvarSessaoCliente(sessionB);
    expect(lerSessaoCliente()).toEqual(sessionB);
    expect(localStorage.getItem(oldKey)).toBeNull();
    removerSessaoCliente();
    expect(lerSessaoCliente()).toBeNull();
  });

  it('rejects corrupt or incomplete stored sessions', () => {
    localStorage.setItem('banca:cliente-session:v2:banca-a', JSON.stringify({ token: 'a', nome: 'A' }));
    expect(lerSessaoCliente()).toBeNull();
    localStorage.setItem('banca:cliente-session:v2:banca-a', '{broken json');
    expect(lerSessaoCliente()).toBeNull();
    visit('banca-ana-maria');
    localStorage.setItem(oldKey, JSON.stringify({ token: '', clienteId: 'c', nome: 'A' }));
    expect(lerSessaoCliente()).toBeNull();
  });
});
