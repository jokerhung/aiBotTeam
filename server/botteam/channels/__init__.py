"""Messaging channels that start a bot when a message arrives (the Input tab): a Telegram bot, a Zalo bot.

Not Composio: the server keeps each bot token itself, because it has to read incoming messages and download the files people send.
"""
from .base import ChannelError
from .service import ADAPTERS, INFO, MAX_ACCOUNTS, ChannelService

__all__ = ["ADAPTERS", "INFO", "MAX_ACCOUNTS", "ChannelError", "ChannelService"]
