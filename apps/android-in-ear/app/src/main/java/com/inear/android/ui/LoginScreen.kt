package com.inear.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun LoginScreen(vm: InEarViewModel) {
    var api by remember { mutableStateOf("http://192.168.0.10:3847") }
    var user by remember { mutableStateOf("musician1") }
    var pass by remember { mutableStateOf("musician1") }
    val err by vm.error.collectAsState()

    Column(
        Modifier
            .fillMaxWidth()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("inEar — retorno", style = androidx.compose.material3.MaterialTheme.typography.headlineSmall)
        OutlinedTextField(
            value = api,
            onValueChange = { api = it },
            label = { Text("API (http://IP:3847)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        OutlinedTextField(
            value = user,
            onValueChange = { user = it },
            label = { Text("Utilizador") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = pass,
            onValueChange = { pass = it },
            label = { Text("Senha") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
        )
        if (err != null) {
            Text(err!!, color = androidx.compose.material3.MaterialTheme.colorScheme.error)
        }
        Button(
            onClick = {
                vm.clearError()
                vm.login(api, user, pass)
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Entrar")
        }
    }
}
