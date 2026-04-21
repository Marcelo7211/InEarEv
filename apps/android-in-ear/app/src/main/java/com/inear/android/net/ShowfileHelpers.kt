package com.inear.android.net

private val IF_NUM = Regex("^if_(\\d+)$")

fun sortedInterfaceInputIds(allChannelIds: List<String>): List<String> =
    allChannelIds
        .filter { IF_NUM.matches(it) }
        .sortedBy { IF_NUM.matchEntire(it)!!.groupValues[1].toInt() }

fun musicianScopeHasValidTarget(sf: Showfile, m: MusicianStrip): Boolean {
    val chSet = sf.channels.map { it.id }.toSet()
    for (cid in m.scope.channelIds) {
        if (chSet.contains(cid)) return true
    }
    for (gid in m.scope.groupIds) {
        if (sf.groups.any { it.id == gid }) return true
    }
    return false
}

fun visibleChannelIdsForMusician(sf: Showfile, m: MusicianStrip): List<String> {
    val all = sf.channels.map { it.id }
    if (all.isEmpty()) return emptyList()
    val explicit = m.scope.channelIds.isNotEmpty() || m.scope.groupIds.isNotEmpty()
    if (!explicit || !musicianScopeHasValidTarget(sf, m)) return all
    val set = LinkedHashSet<String>()
    for (cid in m.scope.channelIds) {
        if (all.contains(cid)) set.add(cid)
    }
    for (gid in m.scope.groupIds) {
        val g = sf.groups.find { it.id == gid } ?: continue
        for (cid in g.channelIds) {
            if (all.contains(cid)) set.add(cid)
        }
    }
    val resolved = set.toList()
    if (resolved.isEmpty()) return all

    val allIf = sortedInterfaceInputIds(all)
    val resIf = resolved.filter { IF_NUM.matches(it) }
    val onlyIfInResolved = resIf.size == resolved.size
    val subsetOfAllIf = onlyIfInResolved &&
        allIf.isNotEmpty() &&
        resIf.isNotEmpty() &&
        resIf.size < allIf.size &&
        resIf.all { allIf.contains(it) }
    return if (subsetOfAllIf) allIf else resolved
}

fun retornoMixerChannelOrder(sf: Showfile, m: MusicianStrip): List<String> {
    val allIf = sortedInterfaceInputIds(sf.channels.map { it.id })
    val vis = visibleChannelIdsForMusician(sf, m)
    val rest = vis.filter { !IF_NUM.matches(it) }
    return allIf + rest
}
