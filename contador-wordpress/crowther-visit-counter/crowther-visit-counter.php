<?php
/**
 * Plugin Name: Crowther Visit Reports
 * Description: Recuento aproximado de sesiones de Crowther y envío periódico por correo.
 * Version: 1.0.0
 * Author: Jacobo Feijóo
 * License: GPL-3.0-or-later
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

defined('ABSPATH') || exit;

final class Crowther_Visit_Counter {
    private const OPTION = 'crowther_visit_counter_options';
    private const COUNTS = 'crowther_visit_counter_daily_counts';
    private const LAST_REPORT = 'crowther_visit_counter_last_report_day';
    private const CRON_HOOK = 'crowther_visit_counter_send_report';
    private const CRON_SCHEDULE = 'crowther_visit_counter_interval';
    private const REST_NAMESPACE = 'crowther-visit-counter/v1';

    public static function boot(): void {
        add_filter('cron_schedules', [self::class, 'add_cron_schedule']);
        add_action('rest_api_init', [self::class, 'register_endpoint']);
        add_action('admin_menu', [self::class, 'add_admin_page']);
        add_action('admin_post_crowther_visit_counter_save', [self::class, 'save_settings']);
        add_action('admin_post_crowther_visit_counter_test', [self::class, 'send_test_report']);
        add_action(self::CRON_HOOK, [self::class, 'send_scheduled_report']);
        add_action('init', [self::class, 'ensure_schedule']);
    }

    private static function defaults(): array {
        return [
            'email' => (string) get_option('admin_email', ''),
            'origin' => self::site_origin(home_url('/')),
            'interval_days' => 7,
        ];
    }

    private static function settings(): array {
        $saved = get_option(self::OPTION, []);
        return wp_parse_args(is_array($saved) ? $saved : [], self::defaults());
    }

    public static function activate(): void {
        if (false === get_option(self::OPTION)) {
            add_option(self::OPTION, self::defaults(), '', false);
        }
        self::schedule_event();
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook(self::CRON_HOOK);
    }

    public static function add_cron_schedule(array $schedules): array {
        $days = max(1, min(365, absint(self::settings()['interval_days'])));
        $schedules[self::CRON_SCHEDULE] = [
            'interval' => $days * DAY_IN_SECONDS,
            'display' => sprintf('Cada %d día(s) (Crowther)', $days),
        ];
        return $schedules;
    }

    public static function ensure_schedule(): void {
        if (!wp_next_scheduled(self::CRON_HOOK) && is_email(self::settings()['email'])) {
            self::schedule_event();
        }
    }

    private static function schedule_event(): void {
        wp_clear_scheduled_hook(self::CRON_HOOK);
        $settings = self::settings();
        if (!is_email($settings['email'])) {
            return;
        }

        $days = max(1, min(365, absint($settings['interval_days'])));
        wp_schedule_event(time() + ($days * DAY_IN_SECONDS), self::CRON_SCHEDULE, self::CRON_HOOK);
    }

    public static function register_endpoint(): void {
        register_rest_route(self::REST_NAMESPACE, '/hit', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [self::class, 'record_visit'],
            'permission_callback' => '__return_true',
        ]);
    }

    public static function record_visit(WP_REST_Request $request) {
        $settings = self::settings();
        $origin = self::site_origin((string) $request->get_header('origin'));
        $marker = (string) $request->get_header('x-crowther-visit');

        // Solo admite llamadas del origen configurado y del pequeño script del plugin.
        if (!$origin || !hash_equals((string) $settings['origin'], $origin) || '1' !== $marker) {
            return new WP_Error(
                'crowther_visit_origin_denied',
                'Origen no autorizado.',
                ['status' => 403]
            );
        }

        $today = current_datetime()->format('Y-m-d');
        $counts = get_option(self::COUNTS, []);
        if (!is_array($counts)) {
            $counts = [];
        }

        $counts[$today] = max(0, absint($counts[$today] ?? 0)) + 1;
        $keep_from = current_datetime()->modify('-364 days')->format('Y-m-d');
        foreach (array_keys($counts) as $date) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date) || $date < $keep_from) {
                unset($counts[$date]);
            }
        }

        update_option(self::COUNTS, $counts, false);
        return new WP_REST_Response(null, 204);
    }

    private static function site_origin(string $url): string {
        $parts = wp_parse_url(trim($url));
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            return '';
        }
        $scheme = strtolower((string) $parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true)) {
            return '';
        }

        $origin = $scheme . '://' . strtolower((string) $parts['host']);
        if (!empty($parts['port'])) {
            $origin .= ':' . absint($parts['port']);
        }
        return $origin;
    }

    public static function add_admin_page(): void {
        add_options_page(
            'Informes de Crowther',
            'Visitas de Crowther',
            'manage_options',
            'crowther-visit-counter',
            [self::class, 'render_admin_page']
        );
    }

    public static function render_admin_page(): void {
        if (!current_user_can('manage_options')) {
            return;
        }

        $settings = self::settings();
        $counts = get_option(self::COUNTS, []);
        $counts = is_array($counts) ? $counts : [];
        $next = wp_next_scheduled(self::CRON_HOOK);
        $last_report = (string) get_option(self::LAST_REPORT, '');
        $script_url = plugins_url('crowther-counter.js', __FILE__);
        $integration_tag = sprintf(
            '<script defer src="%s" data-endpoint="%s"></script>',
            esc_url($script_url),
            esc_url(rest_url(self::REST_NAMESPACE . '/hit'))
        );
        ?>
        <div class="wrap">
            <h1>Informes de visitas de Crowther</h1>
            <?php if (isset($_GET['saved'])) : ?>
                <div class="notice notice-success is-dismissible"><p>Ajustes guardados.</p></div>
            <?php elseif (isset($_GET['test_sent'])) : ?>
                <div class="notice notice-success is-dismissible"><p>Informe de prueba enviado.</p></div>
            <?php elseif (isset($_GET['mail_error'])) : ?>
                <div class="notice notice-error is-dismissible"><p>No se pudo enviar el correo. Revisa la configuración de correo de WordPress.</p></div>
            <?php elseif (isset($_GET['invalid'])) : ?>
                <div class="notice notice-error is-dismissible"><p>Revisa el correo y el origen web. No se guardaron los ajustes.</p></div>
            <?php endif; ?>

            <p>El recuento es aproximado: registra una carga por pestaña y día. No almacena IP, nombre ni cookie; solo conserva totales diarios.</p>

            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="crowther_visit_counter_save">
                <?php wp_nonce_field('crowther_visit_counter_save'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="cvc-email">Enviar informes a</label></th>
                        <td><input class="regular-text" type="email" required id="cvc-email" name="email" value="<?php echo esc_attr($settings['email']); ?>"></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="cvc-origin">Origen de Crowther</label></th>
                        <td>
                            <input class="regular-text" type="url" required id="cvc-origin" name="origin" value="<?php echo esc_attr($settings['origin']); ?>" placeholder="https://ejemplo.com">
                            <p class="description">Solo protocolo, dominio y puerto; sin /crowther ni otras rutas.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="cvc-days">Frecuencia del informe</label></th>
                        <td>
                            <input type="number" id="cvc-days" name="interval_days" min="1" max="365" value="<?php echo esc_attr((string) $settings['interval_days']); ?>">
                            <span>días (de 1 a 365)</span>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Guardar ajustes'); ?>
            </form>

            <hr>
            <h2>Conectar la web de Crowther</h2>
            <p>Activa el plugin y añade esta línea, por separado, al <code>index.html</code> que ya está publicado en <code>/crowther</code>, justo antes de <code>&lt;/body&gt;</code>. No forma parte de la release del IDE.</p>
            <p><code><?php echo esc_html($integration_tag); ?></code></p>
            <p>El origen permitido debe coincidir exactamente con el protocolo y dominio de la web publicada, por ejemplo <code>https://www.ejemplo.com</code>.</p>

            <h2>Envío programado</h2>
            <p>Último informe: <?php echo $last_report ? esc_html($last_report) : 'todavía ninguno'; ?>. Próxima ejecución aproximada: <?php echo $next ? esc_html(wp_date('d/m/Y H:i', $next)) : 'pendiente de programar'; ?>.</p>
            <p>WordPress ejecuta sus tareas programadas cuando recibe visitas; con poco tráfico el correo puede retrasarse. Para puntualidad, configura en el hosting una tarea cron que invoque <code>wp-cron.php</code>.</p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="crowther_visit_counter_test">
                <?php wp_nonce_field('crowther_visit_counter_test'); ?>
                <?php submit_button('Enviar informe de prueba', 'secondary', 'submit', false); ?>
            </form>

            <h2>Últimos 30 días</h2>
            <table class="widefat striped" style="max-width:560px">
                <thead><tr><th>Fecha</th><th>Visitas aproximadas</th></tr></thead>
                <tbody>
                    <?php for ($offset = 0; $offset < 30; $offset++) :
                        $date = current_datetime()->modify('-' . $offset . ' days')->format('Y-m-d'); ?>
                        <tr><td><?php echo esc_html($date); ?></td><td><?php echo esc_html((string) absint($counts[$date] ?? 0)); ?></td></tr>
                    <?php endfor; ?>
                </tbody>
            </table>
            <p class="description">El servidor del hosting puede mantener sus propios registros de acceso, independientemente de este plugin. Actualiza el aviso de privacidad si corresponde.</p>
        </div>
        <?php
    }

    public static function save_settings(): void {
        if (!current_user_can('manage_options')) {
            wp_die('No tienes permiso para cambiar estos ajustes.');
        }
        check_admin_referer('crowther_visit_counter_save');

        $email = sanitize_email(wp_unslash($_POST['email'] ?? ''));
        $origin = self::site_origin(sanitize_text_field(wp_unslash($_POST['origin'] ?? '')));
        $days = absint(wp_unslash($_POST['interval_days'] ?? 7));
        if (!is_email($email) || !$origin || $days < 1 || $days > 365) {
            wp_safe_redirect(add_query_arg('invalid', '1', admin_url('options-general.php?page=crowther-visit-counter')));
            exit;
        }

        update_option(self::OPTION, [
            'email' => $email,
            'origin' => $origin,
            'interval_days' => $days,
        ], false);
        self::schedule_event();
        wp_safe_redirect(add_query_arg('saved', '1', admin_url('options-general.php?page=crowther-visit-counter')));
        exit;
    }

    public static function send_test_report(): void {
        if (!current_user_can('manage_options')) {
            wp_die('No tienes permiso para enviar este informe.');
        }
        check_admin_referer('crowther_visit_counter_test');
        $sent = self::send_report(true);
        $key = $sent ? 'test_sent' : 'mail_error';
        wp_safe_redirect(add_query_arg($key, '1', admin_url('options-general.php?page=crowther-visit-counter')));
        exit;
    }

    public static function send_scheduled_report(): void {
        self::send_report(false);
    }

    private static function send_report(bool $test): bool {
        $settings = self::settings();
        if (!is_email($settings['email'])) {
            return false;
        }

        $today = current_datetime()->setTime(0, 0);
        $days = max(1, min(365, absint($settings['interval_days'])));
        $last_day = (string) get_option(self::LAST_REPORT, '');
        if ($test || !$last_day) {
            $start = $today->modify('-' . ($days - 1) . ' days');
        } else {
            $previous_report = DateTimeImmutable::createFromFormat('!Y-m-d', $last_day, wp_timezone());
            $start = $previous_report instanceof DateTimeImmutable
                ? $previous_report->modify('+1 day')
                : $today;
        }
        if ($start > $today) {
            $start = $today;
        }

        $counts = get_option(self::COUNTS, []);
        $counts = is_array($counts) ? $counts : [];
        $total = 0;
        $lines = [
            'Informe de visitas aproximadas de Crowther',
            'Periodo: ' . $start->format('Y-m-d') . ' a ' . $today->format('Y-m-d'),
            '',
            'Fecha | Visitas',
        ];

        for ($date = $start; $date <= $today; $date = $date->modify('+1 day')) {
            $day = $date->format('Y-m-d');
            $count = absint($counts[$day] ?? 0);
            $total += $count;
            $lines[] = $day . ' | ' . $count;
        }

        array_splice($lines, 2, 0, ['Total del periodo: ' . $total, '']);
        $subject = ($test ? '[Prueba] ' : '') . 'Informe Crowther: ' . $total . ' visitas aproximadas';
        $headers = ['Content-Type: text/plain; charset=UTF-8'];
        $sent = wp_mail($settings['email'], $subject, implode("\n", $lines), $headers);
        if ($sent && !$test) {
            update_option(self::LAST_REPORT, $today->format('Y-m-d'), false);
        }
        return (bool) $sent;
    }
}

Crowther_Visit_Counter::boot();
register_activation_hook(__FILE__, [Crowther_Visit_Counter::class, 'activate']);
register_deactivation_hook(__FILE__, [Crowther_Visit_Counter::class, 'deactivate']);
