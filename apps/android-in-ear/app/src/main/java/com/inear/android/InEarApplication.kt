package com.inear.android

import android.app.Application
import com.inear.android.data.SessionDataStore
import com.inear.android.BuildConfig
import kotlinx.coroutines.runBlocking

class InEarApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    val prefs = getSharedPreferences("inear_prefs", MODE_PRIVATE)
    val vc = BuildConfig.VERSION_CODE
    val stored = prefs.getInt("stored_version_code", -1)
    if (stored != vc) {
      runBlocking {
        SessionDataStore(this@InEarApplication).clear()
      }
      prefs.edit().putInt("stored_version_code", vc).apply()
    }
  }
}
