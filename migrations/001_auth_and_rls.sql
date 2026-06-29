-- ============================================================================
-- Migración 001 — Auth + RLS para Sistema de Reportes Selvadentro
--
-- Corre este script en Supabase Dashboard → SQL Editor.
-- Después de correrlo, sigue las instrucciones del BLOQUE BOOTSTRAP al final
-- para crear el primer usuario admin.
-- ============================================================================

-- --- 1. Tabla user_profiles ---------------------------------------------------
create table if not exists public.user_profiles (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text not null,
  role     text not null default 'user' check (role in ('admin','user')),
  channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- --- 2. Helpers (SECURITY DEFINER para evitar recursión en RLS) ---------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.can_access_channel(ch text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid()
      and (role = 'admin' or ch = any(channels))
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.can_access_channel(text) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_channel(text) to authenticated;

-- --- 3. RLS sobre user_profiles -----------------------------------------------
drop policy if exists up_select on public.user_profiles;
drop policy if exists up_insert on public.user_profiles;
drop policy if exists up_update on public.user_profiles;
drop policy if exists up_delete on public.user_profiles;

create policy up_select on public.user_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy up_insert on public.user_profiles
  for insert to authenticated
  with check (public.is_admin());

create policy up_update on public.user_profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy up_delete on public.user_profiles
  for delete to authenticated
  using (public.is_admin());

-- --- 4. RLS sobre kv (reemplaza kv_anon_all) ----------------------------------
-- Quitar la política vieja que dejaba todo abierto al rol anon
drop policy if exists kv_anon_all on public.kv;

drop policy if exists kv_select on public.kv;
drop policy if exists kv_insert on public.kv;
drop policy if exists kv_update on public.kv;
drop policy if exists kv_delete on public.kv;

-- Claves globales de configuración (selvadentro:asesores, selvadentro:metas, selvadentro:logo):
-- todos los authenticated leen, solo admin escribe/borra.
create policy kv_select on public.kv
  for select to authenticated
  using (
    split_part(k, ':', 1) = 'selvadentro'
    or public.can_access_channel(split_part(k, ':', 1))
  );

create policy kv_insert on public.kv
  for insert to authenticated
  with check (
    case when split_part(k, ':', 1) = 'selvadentro' then public.is_admin()
         else public.can_access_channel(split_part(k, ':', 1))
    end
  );

create policy kv_update on public.kv
  for update to authenticated
  using (
    case when split_part(k, ':', 1) = 'selvadentro' then public.is_admin()
         else public.can_access_channel(split_part(k, ':', 1))
    end
  )
  with check (
    case when split_part(k, ':', 1) = 'selvadentro' then public.is_admin()
         else public.can_access_channel(split_part(k, ':', 1))
    end
  );

create policy kv_delete on public.kv
  for delete to authenticated
  using (
    case when split_part(k, ':', 1) = 'selvadentro' then public.is_admin()
         else public.can_access_channel(split_part(k, ':', 1))
    end
  );

-- --- 5. Trigger updated_at ----------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.tg_set_updated_at();


-- ============================================================================
-- BOOTSTRAP — Crear primer admin
-- ----------------------------------------------------------------------------
-- Paso 1: ve a Authentication → Users → "Add user" → "Create new user"
--         Email: hoshi@selvadentrotulum.com
--         Password: el que prefieras (lo cambias después si quieres)
--         Marca "Auto Confirm User"
--
-- Paso 2: copia el UUID del usuario recién creado y pégalo abajo,
--         después corre este INSERT:
--
-- insert into public.user_profiles (user_id, email, role, channels)
-- values (
--   'PEGA_AQUI_EL_UUID',
--   'hoshi@selvadentrotulum.com',
--   'admin',
--   array['brokers','paid_organico','seminarios','referidos','pd_leads','pd_brokers','rp_vip']
-- );
--
-- Después de eso, el usuario admin puede crear y editar a todos los demás
-- desde el panel Admin del sitio.
-- ============================================================================
