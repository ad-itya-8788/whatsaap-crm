<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class WhatsappConfig extends Model {
    protected $fillable = [
        'user_id','phone_number_id','waba_id','access_token','verify_token','status','connected_at',
        'registered_at','subscribed_apps_at','last_registration_error','mirror_inbound_media'
    ];
    protected $casts = [
        'access_token'=>'encrypted','verify_token'=>'encrypted',
        'connected_at'=>'datetime','registered_at'=>'datetime','subscribed_apps_at'=>'datetime',
        'mirror_inbound_media'=>'boolean'
    ];
    protected $hidden = ['access_token','verify_token'];
}
