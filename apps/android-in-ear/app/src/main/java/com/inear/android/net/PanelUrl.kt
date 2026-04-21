package com.inear.android.net

import java.net.URL

fun buildPanelUrl(apiBase: String, token: String, role: String): String {
    val base = apiBase.trim().trimEnd('/')
    val hostname = URL(base).host
    val qs = listOf(
        "api=${java.net.URLEncoder.encode(base, Charsets.UTF_8.name())}",
        "inear_token=${java.net.URLEncoder.encode(token, Charsets.UTF_8.name())}",
        "inear_role=${java.net.URLEncoder.encode(role, Charsets.UTF_8.name())}",
    ).joinToString("&")
    return "http://$hostname:5173/?$qs"
}
