<?php
/**
 * WonderfulOS: el aspecto de WonderfulOS y los servidores de los proveedores más comunes, para
 * entrar solo con el correo y la contraseña.
 */
class colormail extends rcube_plugin
{
    // dominio => [IMAP, SMTP]
    private const PROVIDERS = [
        'gmail.com'      => ['ssl://imap.gmail.com:993', 'ssl://smtp.gmail.com:465'],
        'googlemail.com' => ['ssl://imap.gmail.com:993', 'ssl://smtp.gmail.com:465'],
        'outlook.com'    => ['ssl://outlook.office365.com:993', 'tls://smtp.office365.com:587'],
        'outlook.es'     => ['ssl://outlook.office365.com:993', 'tls://smtp.office365.com:587'],
        'hotmail.com'    => ['ssl://outlook.office365.com:993', 'tls://smtp.office365.com:587'],
        'hotmail.es'     => ['ssl://outlook.office365.com:993', 'tls://smtp.office365.com:587'],
        'live.com'       => ['ssl://outlook.office365.com:993', 'tls://smtp.office365.com:587'],
        'msn.com'        => ['ssl://outlook.office365.com:993', 'tls://smtp.office365.com:587'],
        'icloud.com'     => ['ssl://imap.mail.me.com:993', 'tls://smtp.mail.me.com:587'],
        'me.com'         => ['ssl://imap.mail.me.com:993', 'tls://smtp.mail.me.com:587'],
        'mac.com'        => ['ssl://imap.mail.me.com:993', 'tls://smtp.mail.me.com:587'],
        'yahoo.com'      => ['ssl://imap.mail.yahoo.com:993', 'ssl://smtp.mail.yahoo.com:465'],
        'yahoo.es'       => ['ssl://imap.mail.yahoo.com:993', 'ssl://smtp.mail.yahoo.com:465'],
        'gmx.com'        => ['ssl://imap.gmx.com:993', 'tls://mail.gmx.com:587'],
        'gmx.es'         => ['ssl://imap.gmx.com:993', 'tls://mail.gmx.com:587'],
        'zoho.com'       => ['ssl://imap.zoho.eu:993', 'ssl://smtp.zoho.eu:465'],
    ];

    public function init()
    {
        $this->add_hook('authenticate', [$this, 'authenticate']);
        $this->add_hook('smtp_connect', [$this, 'smtp_connect']);
        $this->add_hook('login_failed', [$this, 'login_failed']);
        $this->include_stylesheet('colormail.css');
    }

    private static function provider($user)
    {
        $domain = strtolower(substr(strrchr((string) $user, '@'), 1));
        return self::PROVIDERS[$domain] ?? null;
    }

    public function authenticate($args)
    {
        $args['user'] = trim($args['user']);
        // Las contraseñas de aplicación (Google, Apple, Yahoo) se muestran en grupos de 4 letras
        // separados por espacios: se quitan, porque con espacios el servidor las rechaza.
        if (preg_match('/^[a-z]{4}([ -][a-z]{4}){3}$/i', trim($args['pass']))) {
            $args['pass'] = preg_replace('/[ -]/', '', trim($args['pass']));
        }
        if ($p = self::provider($args['user'])) {
            $args['host'] = $p[0];
        }
        return $args;
    }

    /** Explica de verdad por qué no se pudo entrar (Gmail, iCloud… no aceptan la contraseña normal). */
    public function login_failed($args)
    {
        $rcmail = rcmail::get_instance();
        $error = $rcmail->storage ? (string) $rcmail->storage->get_error_str() : '';
        $domain = strtolower(substr(strrchr((string) $args['user'], '@'), 1));
        $msg = null;
        if (in_array($domain, ['gmail.com', 'googlemail.com'])) {
            $msg = 'Gmail no deja usar tu contraseña normal en otras apps. Crea una «contraseña de aplicación» en myaccount.google.com/apppasswords (hace falta tener activada la verificación en dos pasos) y escríbela aquí.';
        } elseif (in_array($domain, ['icloud.com', 'me.com', 'mac.com'])) {
            $msg = 'iCloud pide una «contraseña específica para apps»: créala en account.apple.com › Inicio de sesión y seguridad, y escríbela aquí.';
        } elseif (strpos($domain, 'yahoo.') === 0) {
            $msg = 'Yahoo pide una «contraseña de aplicación»: créala en login.yahoo.com › Seguridad de la cuenta, y escríbela aquí.';
        } elseif (in_array($domain, ['outlook.com', 'outlook.es', 'hotmail.com', 'hotmail.es', 'live.com', 'msn.com'])) {
            $msg = 'Microsoft ya no deja entrar con contraseña desde otras apps de correo en las cuentas de Outlook y Hotmail. Pronto podrás entrar con «Iniciar sesión con Microsoft».';
        } elseif (stripos($error, 'Application-specific password') !== false || stripos($error, 'app password') !== false) {
            $msg = 'Tu proveedor pide una «contraseña de aplicación» en lugar de tu contraseña normal. Créala en la configuración de seguridad de tu cuenta y escríbela aquí.';
        } elseif ($error && stripos($error, 'Invalid credentials') === false && stripos($error, 'AUTHENTICATE') === false) {
            $msg = 'No se pudo conectar con el servidor de correo de ' . $domain . '. Comprueba la dirección.';
        }
        if ($msg) {
            $rcmail->output->show_message($msg, 'warning', null, true, 30);
        }
        return $args;
    }

    public function smtp_connect($args)
    {
        if ($p = self::provider(rcmail::get_instance()->get_user_name())) {
            $args['smtp_host'] = $p[1];
        }
        return $args;
    }
}
