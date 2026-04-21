package com.inear.android.net

import android.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

fun parseJwtSub(token: String): String? {
    val parts = token.split('.')
    if (parts.size < 2) return null
    return try {
        var payload = parts[1]
        when (payload.length % 4) {
            2 -> payload += "=="
            3 -> payload += "="
            else -> {}
        }
        val decoded = Base64.decode(
            payload,
            Base64.URL_SAFE or Base64.NO_WRAP,
        )
        val obj = Json.parseToJsonElement(String(decoded, Charsets.UTF_8)) as JsonObject
        obj["sub"]?.jsonPrimitive?.content
    } catch (_: Exception) {
        null
    }
}
