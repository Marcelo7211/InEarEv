package com.inear.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "inear_session")

class SessionDataStore(private val context: Context) {
    private val keyBase = stringPreferencesKey("api_base")
    private val keyToken = stringPreferencesKey("token")
    private val keyRole = stringPreferencesKey("role")

    val session: Flow<Triple<String?, String?, String?>> = context.dataStore.data.map { p ->
        Triple(p[keyBase], p[keyToken], p[keyRole])
    }

    suspend fun saveSession(apiBase: String, token: String, role: String) {
        context.dataStore.edit { p ->
            p[keyBase] = apiBase.trim().trimEnd('/')
            p[keyToken] = token
            p[keyRole] = role
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
