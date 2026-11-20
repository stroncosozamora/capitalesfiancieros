# Activación del portal de Capitales Financieros

El sitio conserva su configuración actual para reuniones, recomendaciones y correo. El portal usa la URL de Supabase y una clave **publicable** propia del proyecto de Capitales Financieros.

1. En Supabase, identifica el proyecto a partir de `SUPABASE_URL` del proyecto de Vercel. Aplica `supabase/portal-asesorias.sql` en una base de pruebas primero. El archivo agrega tres tablas con Row Level Security y un esquema privado.
2. En Vercel, agrega `SUPABASE_PUBLISHABLE_KEY` para el entorno correspondiente. Configura `SUPABASE_URL` de forma que cada entorno use su base. El portal usa la sesión individual para consultar las tablas.
3. En Supabase Auth, habilita email y contraseña con confirmación de correo, configura el SMTP del proyecto y fija la URL del sitio en `https://capitalesfinancieros.cl/portal/` para producción. Para probar el flujo de correo en otro entorno, usa su URL autorizada y una base separada.
4. Desde `/portal/`, registra y confirma la cuenta personal del administrador. Después, desde el editor SQL de Supabase y con el correo verificado, ejecuta:

   ```sql
   insert into public.cf_staff (user_id, role)
   select id, 'admin'
   from auth.users
   where lower(email) = lower('REEMPLAZAR_POR_CORREO_VERIFICADO')
     and email_confirmed_at is not null;
   ```

   Comprueba que se insertó una fila. La contraseña la elige el titular en el formulario y la gestiona Supabase Auth.

5. Prueba con un agente y dos clientes de prueba. Aprueba la solicitud del agente en Administración. Usa el código de un cliente para crear una asesoría y luego publícala. Comprueba que el destinatario puede leerla y el segundo cliente no tiene acceso.

El módulo público está en `/herramientas/` y el portal en `/portal/`. Las cifras del IGC corresponden al AT 2026. La vista mensual usa las tablas generales del SII de 2026 y requiere la UF oficial de cierre de mes para el escenario por planilla.
